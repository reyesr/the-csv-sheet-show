import type * as vscode from 'vscode';
import type { CsvDocument } from '../CsvDocument';
import { checkDuckDbExecutable, DuckDbTerminalService } from '../duckdb/DuckDbTerminalService';
import { ExportService } from '../export/ExportService';
import type { UiPreferenceStore } from '../preferences/UiPreferenceStore';
import type { DuckDbStatus } from '../shared/messages/duckdb';
import { CsvLoadErrorReason } from '../shared/messages/errors';
import {
	formatLogData,
	isAddHeaderRowMessage,
	isCheckDuckDbRequestMessage,
	isDeleteRowRangeMessage,
	isExportRequestMessage,
	isFindRequestMessage,
	isInsertRowMessage,
	isLoadedReadyMessage,
	isPageRequest,
	isRequestRowsMessage,
	isRunDuckDbRequestMessage,
	isSetCellContentMessage,
	isSetCsvConfigMessage,
	isSetEditModeMessage,
	isSetHeaderContentMessage,
	isSetMemoryMessage,
	isWebviewLogMessage,
	safeStringify
} from './webviewMessageGuards';

/**
 * Routes a raw `onDidReceiveMessage` payload from the webview to the matching
 * {@link CsvDocument} operation. Each branch validates the message, logs it, then delegates.
 */
export class WebviewMessageRouter {
	public constructor(
		private readonly document: CsvDocument,
		private readonly preferences: UiPreferenceStore,
		private readonly log: (message: string) => void,
		private readonly checkDuckDb: () => Promise<DuckDbStatus> = checkDuckDbExecutable
	) { }

	public handle(message: unknown, panel: vscode.WebviewPanel): void {
		if (isWebviewLogMessage(message)) {
			this.log(`Webview ${message.level}: ${message.message}${formatLogData(message.data)}`);
			return;
		}

		if (isLoadedReadyMessage(message)) {
			this.log(`Webview loaded-ready: offset=${message.offset}, rowCount=${message.rowCount}`);
			this.document.postReadyPageWhenAvailable(message.offset, message.rowCount, panel);
			this.document.postExportCapabilities(panel);
			void panel.webview.postMessage({
				type: 'rememberedState',
				global: this.preferences.getGlobalSnapshot(),
				file: this.preferences.getFileSnapshot(this.document.uri)
			});
			return;
		}

		if (isRequestRowsMessage(message)) {
			try {
				this.log(`Received row request from webview: request=${message.requestId}, reason=${message.reason}, offset=${message.offset}, rowCount=${message.rowCount}`);
				this.document.postRowsIfAvailable(message.requestId, message.offset, message.rowCount, panel);
			} catch (error) {
				this.postUnknownError(panel, 'row request', error);
			}
			return;
		}

		if (isFindRequestMessage(message)) {
			this.log(`Received find request from webview: session=${message.searchSessionId}, action=${message.action}, queryLength=${message.query.length}, matchCase=${message.options.matchCase}, wholeWord=${message.options.wholeWord}, regex=${message.options.regex}`);
			this.document.handleFindRequest(message, panel);
			return;
		}

		if (isSetEditModeMessage(message)) {
			this.log(`Received setEditMode from webview: editable=${message.editable}`);
			this.document.setEditMode(message.editable);
			return;
		}

		if (isSetCellContentMessage(message)) {
			this.log(`Received setCellContent from webview: request=${message.requestId}, row=${message.rowIndex}, column=${message.columnIndex}`);
			this.document.applySetCellContent(message.requestId, message.rowIndex, message.columnIndex, message.value, panel);
			return;
		}

		if (isInsertRowMessage(message)) {
			this.log(`Received insertRow from webview: request=${message.requestId}, row=${message.rowIndex}`);
			this.document.applyInsertRow(message.requestId, message.rowIndex, panel);
			return;
		}

		if (isDeleteRowRangeMessage(message)) {
			this.log(`Received deleteRowRange from webview: request=${message.requestId}, offset=${message.offset}, count=${message.count}`);
			this.document.applyDeleteRowRange(message.requestId, message.offset, message.count, panel);
			return;
		}

		if (isSetHeaderContentMessage(message)) {
			this.log(`Received setHeaderContent from webview: request=${message.requestId}, column=${message.columnIndex}`);
			this.document.applySetHeaderContent(message.requestId, message.columnIndex, message.value, panel);
			return;
		}

		if (isAddHeaderRowMessage(message)) {
			this.log(`Received addHeaderRow from webview: request=${message.requestId}, columnCount=${message.columnCount}`);
			this.document.applyAddHeaderRow(message.requestId, message.columnCount, panel);
			return;
		}

		if (isSetCsvConfigMessage(message)) {
			this.log(`Received setCsvConfig from webview: separator=${JSON.stringify(message.separator)}, encoding=${message.encoding}, lineEnding=${JSON.stringify(message.lineEnding)}, hasHeader=${message.hasHeader}`);
			void this.document.applyConfigChange(message);
			return;
		}

		if (isExportRequestMessage(message)) {
			this.log(`Received exportRequest from webview: request=${message.requestId}, format=${message.format}, destination=${message.destination}, scope=${message.scope}`);
			const service = new ExportService(this.document.createExportHost(), this.document.uri, panel, this.log);
			void service.run(message);
			return;
		}

		if (isCheckDuckDbRequestMessage(message)) {
			this.log('Received checkDuckDb from webview');
			void this.postDuckDbStatus(panel);
			return;
		}

		if (isRunDuckDbRequestMessage(message)) {
			this.log(`Received runDuckDb from webview: request=${message.requestId}, tableKind=${message.tableKind}, tableName=${JSON.stringify(message.tableName)}, decimalSeparator=${JSON.stringify(message.decimalSeparator)}`);
			const service = new DuckDbTerminalService(this.document.createDuckDbHost(), this.document.uri, this.log);
			void service.run(message);
			return;
		}

		if (isSetMemoryMessage(message)) {
			this.log(`Received setMemory from webview: scope=${message.scope}, key=${message.key}`);
			void (message.scope === 'global'
				? this.preferences.setGlobal(message.key, message.value)
				: this.preferences.setForFile(this.document.uri, message.key, message.value));
			return;
		}

		if (!isPageRequest(message)) {
			this.log(`Ignoring unknown webview message: ${safeStringify(message)}`);
			return;
		}

		try {
			this.log(`Received page request from webview: offset=${message.offset}, rowCount=${message.rowCount}`);
			this.document.postPage(message.offset, message.rowCount, panel);
		} catch (error) {
			this.postUnknownError(panel, 'page request', error);
		}
	}

	private postUnknownError(panel: vscode.WebviewPanel, context: string, error: unknown): void {
		this.log(`Failed to serve ${context}: ${error instanceof Error ? error.message : String(error)}`);
		void panel.webview.postMessage({
			type: 'error',
			reason: CsvLoadErrorReason.Unknown
		});
	}

	private async postDuckDbStatus(panel: vscode.WebviewPanel): Promise<void> {
		try {
			const status = await this.checkDuckDb();
			this.log(`DuckDB status: path=${JSON.stringify(status.path)}, exists=${status.exists}, isExecutable=${status.isExecutable}, origin=${status.origin}`);
			void panel.webview.postMessage({ type: 'duckDbStatus', ...status });
		} catch (error) {
			this.log(`Failed to check DuckDB status: ${error instanceof Error ? error.message : String(error)}`);
			void panel.webview.postMessage({
				type: 'duckDbStatus',
				path: 'duckdb',
				exists: false,
				isExecutable: false,
				origin: 'default-path'
			});
		}
	}
}
