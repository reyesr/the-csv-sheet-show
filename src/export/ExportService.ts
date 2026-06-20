import * as path from 'path';
import * as vscode from 'vscode';
import { INITIAL_PAGE_ROW_COUNT } from '../constants';
import { groupConsecutiveOffsets } from '../find/rowMatching';
import type {
	ExportColumnStyle,
	ExportColumnType,
	ExportFilterDefinition,
	ExportRequestMessage
} from '../shared/messages/export';
import type { ExtensionToWebviewMessage } from '../shared/messages/protocol';
import { getExporter, kindOfType, type ExporterRegistration } from './registry';
import { createFieldFormatter } from './fieldFormatter';
import type { ExportDocumentHost } from './exportHost';
import { ClipboardSink, FileSink } from './sinks';
import type { ExportColumn, ExportContext, ExportSink, TextExportEncoder } from './types';

/** Thrown to unwind the driver loop when the user cancels the progress notification. */
class ExportCancelled extends Error {}

/**
 * Orchestrates one export request: resolve the row plan + columns + types, open the destination
 * sink, drive the format encoder streaming rows in pages, and report progress/result back to the
 * webview. The heavy data never travels to the webview. See architecture.md §3.2.
 */
export class ExportService {
	public constructor(
		private readonly host: ExportDocumentHost,
		private readonly sourceUri: vscode.Uri,
		private readonly panel: vscode.WebviewPanel,
		private readonly log: (message: string) => void = () => { }
	) { }

	public async run(request: ExportRequestMessage): Promise<void> {
		try {
			await this.runInternal(request);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log(`Export failed: ${message}`);
			this.post({ type: 'exportError', requestId: request.requestId, message });
		}
	}

	private async runInternal(request: ExportRequestMessage): Promise<void> {
		const exporter = getExporter(request.format);
		if (exporter === undefined) {
			this.post({ type: 'exportError', requestId: request.requestId, message: `Unsupported export format: ${request.format}.` });
			return;
		}

		// Best-effort pre-checks so we can fail fast before opening the save dialog. The authoritative
		// reads (config, columns, row plan, row data) all happen inside prepareAndExport under
		// host.runExclusive, where the reader and overlay are guaranteed not to be mid re-index.
		if (!this.host.isIndexingFinal()) {
			this.post({ type: 'exportError', requestId: request.requestId, message: 'The file is still loading. Try the export again once loading finishes.' });
			return;
		}
		if (this.host.getConfig() === null) {
			this.post({ type: 'exportError', requestId: request.requestId, message: 'The CSV configuration is not available yet.' });
			return;
		}

		if (request.destination === 'clipboard') {
			await this.host.runExclusive(() => this.prepareAndExport(exporter, new ClipboardSink(), request, undefined));
			return;
		}

		// The save dialog is deliberately outside runExclusive: holding the queue while the user picks a
		// file would block saves/config changes on user interaction. A save may run during the dialog;
		// prepareAndExport re-reads the (now stable) document state once it acquires the queue.
		const target = await vscode.window.showSaveDialog({ defaultUri: this.defaultSaveUri(exporter.descriptor.fileExtension) });
		if (target === undefined) {
			this.post({ type: 'exportError', requestId: request.requestId, message: 'Export cancelled.' });
			return;
		}

		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, cancellable: true, title: `Exporting ${request.format.toUpperCase()}…` },
			(_progress, token) => this.host.runExclusive(() => this.prepareAndExport(exporter, new FileSink(target.fsPath), request, token))
		);
	}

	/**
	 * Resolve everything that reads document state (config, columns, the row plan and the row data)
	 * and drive the sink — all while the document's operation queue is held, so the reader/overlay
	 * stay stable for the whole export. Validation that depends on document state lives here (not in
	 * the pre-checks) so it reflects the state actually exported.
	 */
	private async prepareAndExport(
		exporter: ExporterRegistration,
		sink: ExportSink,
		request: ExportRequestMessage,
		token: vscode.CancellationToken | undefined
	): Promise<void> {
		if (!this.host.isIndexingFinal()) {
			this.post({ type: 'exportError', requestId: request.requestId, message: 'The file is still loading. Try the export again once loading finishes.' });
			return;
		}

		const config = this.host.getConfig();
		if (config === null) {
			this.post({ type: 'exportError', requestId: request.requestId, message: 'The CSV configuration is not available yet.' });
			return;
		}

		const columns = this.resolveColumns(request, config.hasHeader);
		if (columns.length === 0) {
			this.post({ type: 'exportError', requestId: request.requestId, message: 'Select at least one column to export.' });
			return;
		}

		// Resolve the row plan: contiguous range (all) or the filter's matching offsets (filtered).
		const filteredOffsets = request.scope === 'filtered'
			? await this.resolveFilteredOffsets(request.filter)
			: null;
		const totalRows = filteredOffsets !== null ? filteredOffsets.length : this.host.getDisplayedReadableRowCount();

		const context: ExportContext = {
			columns,
			hasHeader: config.hasHeader,
			rowCount: totalRows,
			formatOptions: request.formatOptions,
			formatField: createFieldFormatter(columns, config.decimalSeparator)
		};

		await this.exportTo(sink, exporter.createEncoder(), context, request, filteredOffsets, totalRows, token);
	}

	/** Open/drive/finalize a sink, posting completion or (on failure) cleaning up + posting an error. */
	private async exportTo(
		sink: ExportSink,
		encoder: TextExportEncoder,
		context: ExportContext,
		request: ExportRequestMessage,
		filteredOffsets: number[] | null,
		totalRows: number,
		token: vscode.CancellationToken | undefined
	): Promise<void> {
		try {
			const rowsProcessed = await this.drive(sink, encoder, context, request, filteredOffsets, totalRows, token);
			const result = await sink.finalize();
			this.post({
				type: 'exportComplete',
				requestId: request.requestId,
				destination: request.destination,
				rowCount: rowsProcessed,
				byteCount: result.byteCount,
				filePath: result.filePath
			});
		} catch (error) {
			await sink.dispose();
			const message = error instanceof ExportCancelled ? 'Export cancelled.' : (error instanceof Error ? error.message : String(error));
			this.log(`Export failed: ${message}`);
			this.post({ type: 'exportError', requestId: request.requestId, message });
		}
	}

	/** The uniform encoder loop: begin → encodeRow per row (in pages) → end. Returns rows emitted. */
	private async drive(
		sink: ExportSink,
		encoder: TextExportEncoder,
		context: ExportContext,
		request: ExportRequestMessage,
		filteredOffsets: number[] | null,
		totalRows: number,
		token: vscode.CancellationToken | undefined
	): Promise<number> {
		sink.write(encoder.begin(context));
		let processed = 0;

		const emitRow = (cells: string[]): void => {
			const projected = context.columns.map(column => cells[column.sourceIndex] ?? '');
			sink.write(encoder.encodeRow(projected, processed, context));
			processed += 1;
		};

		if (filteredOffsets !== null) {
			for (const run of groupConsecutiveOffsets(filteredOffsets)) {
				this.throwIfCancelled(token);
				for (const row of this.host.readVirtualRows(run.start, run.length)) {
					emitRow(row);
				}
				await sink.drain();
				this.post({ type: 'exportProgress', requestId: request.requestId, rowsProcessed: processed, totalRows });
			}
		} else {
			for (let offset = 0; offset < totalRows; offset += INITIAL_PAGE_ROW_COUNT) {
				this.throwIfCancelled(token);
				const count = Math.min(INITIAL_PAGE_ROW_COUNT, totalRows - offset);
				for (const row of this.host.readVirtualRows(offset, count)) {
					emitRow(row);
				}
				await sink.drain();
				this.post({ type: 'exportProgress', requestId: request.requestId, rowsProcessed: processed, totalRows });
			}
		}

		sink.write(encoder.end(context));
		await sink.drain();
		return processed;
	}

	/** Resolve the ordered selected columns plus their display names, assigned types, and styling. */
	private resolveColumns(request: ExportRequestMessage, hasHeader: boolean): ExportColumn[] {
		const headerCells = hasHeader ? (this.host.getEffectiveHeaderCells() ?? []) : [];
		const typeById = new Map<number, string>();
		for (const entry of columnTypesFromOptions(request.formatOptions)) {
			typeById.set(entry.columnIndex, entry.typeId);
		}
		const styleByColumn = new Map<number, ExportColumnStyle>();
		for (const style of request.columnStyles) {
			styleByColumn.set(style.columnIndex, style);
		}

		return request.columns.map(sourceIndex => {
			const typeId = typeById.get(sourceIndex) ?? 'text';
			const style = styleByColumn.get(sourceIndex);
			return {
				sourceIndex,
				name: headerCells[sourceIndex]?.trim() ?? '',
				typeId,
				kind: kindOfType(request.format, typeId),
				align: request.retainAlignment ? (style?.align ?? 'left') : 'left',
				foregroundColor: request.retainColors ? (style?.foregroundColor ?? null) : null,
				backgroundColor: request.retainColors ? (style?.backgroundColor ?? null) : null
			};
		});
	}

	/** Run a fresh, self-contained filter scan to completion and return the matching row offsets. */
	private resolveFilteredOffsets(filter: ExportFilterDefinition | undefined): Promise<number[]> {
		if (filter === undefined) {
			return Promise.resolve([]);
		}

		const reader = this.host.createFilterScanReader(filter);
		return new Promise<number[]>((resolve, reject) => {
			reader.on('error', reject);
			reader.on('done', () => resolve([...reader.getMatchingRows()]));
			reader.searchAvailableRows(this.host.getDisplayedReadableRowCount(), true);
		});
	}

	private defaultSaveUri(extension: string): vscode.Uri {
		const base = path.basename(this.sourceUri.fsPath, path.extname(this.sourceUri.fsPath));
		return vscode.Uri.joinPath(this.sourceUri, '..', `${base}.${extension}`);
	}

	private throwIfCancelled(token: vscode.CancellationToken | undefined): void {
		if (token?.isCancellationRequested === true) {
			throw new ExportCancelled();
		}
	}

	private post(message: ExtensionToWebviewMessage): void {
		void this.panel.webview.postMessage(message);
	}
}

/** Read the `columnTypes` array out of the opaque `formatOptions`, ignoring malformed entries. */
function columnTypesFromOptions(formatOptions: Record<string, unknown>): ExportColumnType[] {
	const raw = formatOptions.columnTypes;
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.filter((entry): entry is ExportColumnType =>
		typeof entry === 'object' && entry !== null
		&& typeof (entry as ExportColumnType).columnIndex === 'number'
		&& typeof (entry as ExportColumnType).typeId === 'string');
}
