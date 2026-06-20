import * as fs from 'fs';
import * as vscode from 'vscode';
import { INITIAL_PAGE_ROW_COUNT } from './constants';
import { CsvDocumentChanges, type Change } from './CsvDocumentChanges';
import { CsvEditController, type EditHost } from './CsvEditController';
import { CsvRowView } from './CsvRowView';
import { CsvPageService, type PageHost } from './CsvPageService';
import { PanelBroadcaster } from './webview/PanelBroadcaster';
import type { CsvFileConfig } from './csv/CsvFileConfig';
import { CsvConfigStore, extractHeaderRowKey } from './csv/CsvConfigStore';
import { splitCells } from './csv/splitCells';
import { CsvMappingReaderStats, CsvMappingReader, CsvMappingHeaderEventStruct, CsvMappingReaderError } from './io/CsvMappingReader';
import { writeCsv, writeCsvAndReplaceWithProgress, type CsvWriteSource } from './io/CsvWriter';
import { CsvLoadErrorReason } from './shared/messages/errors';
import { FindController } from './find/FindController';
import type { FindHost } from './find/findTypes';
import { CsvSearchReader } from './io/CsvSearchReader';
import { ColumnType, detectColumnDataTypes } from './csv/detectColumnDataTypes';
import { getExporterDescriptors } from './export/registry';
import type { ExportDocumentHost } from './export/exportHost';
import type { DuckDbDocumentHost } from './duckdb/DuckDbTerminalService';
import type { CsvFileConfigMessage, SetCsvConfigMessage } from './shared/messages/config';
import type { ExportDefaultColumnType, ExportFilterDefinition } from './shared/messages/export';
import type { FindRequestMessage } from './shared/messages/find';
import type { InvalidatedRange } from './shared/messages/editing';
import type { ExtensionToWebviewMessage } from './shared/messages/protocol';

/** Rows sampled from the start of the file to seed export's default per-column types. */
const EXPORT_TYPE_SAMPLE_ROWS = 5000;

/** Percentage at which the save progress bar switches from the write phase to the re-index phase. */
const SAVE_REINDEX_BAND_START = 50;

/** Snapshot persisted for VS Code hot-exit backup. */
export interface CsvDocumentBackup {
	log: Change[];
	nextChangeId: number;
	isEditable: boolean;
}

export class CsvDocument implements vscode.CustomDocument {
	private readonly broadcaster = new PanelBroadcaster();
	private latestStats: CsvMappingReaderStats | null = null;
	private isDisposed = false;
	/** True while save() is materializing the file; edits are rejected so the write sees a stable overlay. */
	private isSaving = false;
	/**
	 * Serializes operations that mutate or read the reader/overlay across `await` points — save,
	 * save-as, config change and export. The extension host is single-threaded, so the only way these
	 * interleave is at suspension points; chaining them through one promise guarantees a re-index or
	 * overlay clear never runs while another operation is mid-read. See {@link enqueue}.
	 */
	private opChain: Promise<unknown> = Promise.resolve();
	/** Last save percentage posted to the webview (−1 = none yet), to throttle saveProgress messages. */
	private lastSavePercent = -1;
	private csvFileConfig: CsvFileConfig | null = null;
	private readonly configStore: CsvConfigStore;

	private readonly changes = new CsvDocumentChanges();
	private baseHeaderCells: string[] | null = null;
	private headerConfig: CsvFileConfigMessage | null = null;
	private latestLoadErrorReason: CsvLoadErrorReason | null = null;
	/** Fires when the change log gains an entry, so the provider can register a VS Code edit (dirty + undo/redo). */
	public readonly onDidEdit: vscode.Event<{ label: string }>;

	public readonly reader: CsvMappingReader;
	private readonly rowView: CsvRowView;
	private readonly pageService: CsvPageService;
	private readonly editController: CsvEditController;
	private readonly findController: FindController;
	public readonly ready: Promise<void>;

	public constructor(public readonly uri: vscode.Uri, context: vscode.ExtensionContext, private readonly log: (message: string) => void = () => { }) {
		this.configStore = new CsvConfigStore(context.workspaceState);
		this.reader = new CsvMappingReader(CsvMappingReader.DEFAULT_CHUNK_SIZE, INITIAL_PAGE_ROW_COUNT, (filepath, chunk) => this.detectExistingConfig(filepath, chunk));
		this.rowView = new CsvRowView(this.reader, this.changes, () => this.csvFileConfig?.hasHeader === true);
		this.pageService = new CsvPageService(this.createPageHost());
		this.editController = new CsvEditController(this.changes, this.rowView, this.createEditHost());
		this.onDidEdit = this.editController.onDidEdit;
		this.findController = new FindController(this.createFindHost());
		this.ready = new Promise(resolve => {
			this.reader.on('stats', stats => {
				this.latestLoadErrorReason = null;
				this.latestStats = stats;
				this.postStatistics(stats);
				this.pageService.postPendingPagesIfAvailable();
				this.findController.advanceFilterScans(stats.isFinal);
			});
			// Permanent 'end' listener: 'stats' only ever fires with isFinal=false, so the file-final
			// signal that lets an active filter scan complete arrives here. Registered once (not per
			// scan) to avoid listener accumulation.
			this.reader.on('end', () => {
				this.findController.advanceFilterScans(true);
			});
			this.reader.on('headers', (header: CsvMappingHeaderEventStruct) => {
				this.baseHeaderCells = splitCells(typeof header.content === 'string' ? header.content : header.content.toString(), header.config.separator)
					.map(cell => cell.trim());
				this.headerConfig = header.config;
				this.postHeaders();
			});

			let handleInitialError: (error: Error) => void = () => { };
			const handleInitialFirstPage = (stats: CsvMappingReaderStats) => {
				this.latestStats = stats;
				this.csvFileConfig = stats.config;
				this.postStatistics(stats);
				this.pageService.postPendingPagesIfAvailable();
				// Resolve as soon as the first page is ready so resolveCustomEditor returns and VS Code
				// reveals the (already-populated) webview, instead of holding its loading spinner until
				// the whole file is parsed. The 'stats'/'end' listeners keep streaming the rest.
				resolve();
			};
			const handleInitialEnd = (stats: CsvMappingReaderStats) => {
				this.reader.off('error', handleInitialError);
				this.latestStats = stats;
				this.postStatistics(stats);
				this.pageService.postPendingPagesIfAvailable();
				resolve();
			};
			handleInitialError = (error: Error) => {
				this.reader.off('first-page', handleInitialFirstPage);
				this.reader.off('end', handleInitialEnd);
				this.handleLoadError(error);
				resolve();
			};

			this.reader.once('first-page', handleInitialFirstPage);
			this.reader.once('end', handleInitialEnd);
			this.reader.once('config', config => {
				// Capture the detected config in memory only; persistence is now explicit (user-driven
				// via applyConfigChange's savingOption), so opening a file no longer remembers it.
				this.csvFileConfig = config;
			});

			this.reader.once('error', handleInitialError);
		});

		this.reader.open(uri.fsPath);
	}

	/**
	 * Resolve a previously saved config from the file's first chunk (the reader calls this and seeds
	 * detectConfig with the result): a per-file ("remember") config keyed by this document's URI wins;
	 * otherwise a "generalize" config keyed by the raw header-row string. `filepath` is the fsPath being
	 * opened — the per-file key uses this document's own `uri`, so it is not needed here.
	 */
	public detectExistingConfig(_filepath: string, initialDataChunk: Buffer): CsvFileConfig | undefined {
		const perFile = this.configStore.getForFile(this.uri);
		if (perFile !== undefined) {
			return perFile;
		}

		const headerRow = extractHeaderRowKey(initialDataChunk);
		if (headerRow === undefined) {
			return undefined;
		}

		return this.configStore.getForHeaders(headerRow);
	}

	/** Persist the applied config according to the user's saving choice (see SetCsvConfigMessage). */
	private persistConfig(config: CsvFileConfig, savingOption: SetCsvConfigMessage['savingOption']): void {
		if (savingOption === 'remember') {
			void this.configStore.saveForFile(this.uri, config);
			return;
		}

		if (savingOption === 'generalize') {
			// Re-read the first chunk and derive the key with the exact same logic detectExistingConfig
			// uses on load, so the keys match byte-for-byte.
			const headerRow = config.hasHeader ? extractHeaderRowKey(readFirstBytes(this.uri.fsPath, CsvMappingReader.DEFAULT_CHUNK_SIZE)) : undefined;
			if (headerRow !== undefined) {
				void this.configStore.saveForHeaders(headerRow, config);
			} else {
				// No header / no line ending to key on — fall back to remembering this file only.
				void this.configStore.saveForFile(this.uri, config);
			}
		}

		// 'none' / undefined: do not persist (and leave any existing entry untouched).
	}

	public attachPanel(panel: vscode.WebviewPanel): void {
		this.broadcaster.add(panel);
		this.log(`Attached webview panel for ${this.uri.fsPath}`);

		panel.onDidDispose(() => {
			this.broadcaster.delete(panel);
			this.pageService.disposePanel(panel);
			this.findController.disposePanel(panel);
		});

		if (this.latestStats !== null) {
			this.postStatistics(this.latestStats, panel);
		}
		if (this.latestLoadErrorReason !== null) {
			this.postLoadError(this.latestLoadErrorReason, panel);
		}

		this.postHeaders(panel);
		this.postMessage({ type: 'editMode', isEditable: this.editController.isEditMode() }, panel);
	}

	public postReadyPageWhenAvailable(offset: number, rowCount: number, panel: vscode.WebviewPanel): void {
		this.pageService.postReadyPageWhenAvailable(offset, rowCount, panel);
	}

	public postRowsIfAvailable(requestId: string, offset: number, rowCount: number, panel: vscode.WebviewPanel): void {
		this.pageService.postRowsIfAvailable(requestId, offset, rowCount, panel);
	}

	public postPage(offset: number, rowCount: number, panel?: vscode.WebviewPanel): void {
		this.pageService.postPage(offset, rowCount, panel);
	}

	public handleFindRequest(request: FindRequestMessage, panel: vscode.WebviewPanel): void {
		this.findController.handleRequest(request, panel);
	}

	// --- Editing (delegated to CsvEditController) ---

	public isEditMode(): boolean {
		return this.editController.isEditMode();
	}

	public setEditMode(editable: boolean): void {
		this.editController.setEditMode(editable);
	}

	public applySetCellContent(requestId: string, rowIndex: number, columnIndex: number, value: string, panel: vscode.WebviewPanel): void {
		if (this.rejectIfSaving(requestId, panel)) {
			return;
		}
		this.editController.applySetCellContent(requestId, rowIndex, columnIndex, value, panel);
	}

	public applyInsertRow(requestId: string, rowIndex: number, panel: vscode.WebviewPanel): void {
		if (this.rejectIfSaving(requestId, panel)) {
			return;
		}
		this.editController.applyInsertRow(requestId, rowIndex, panel);
	}

	public applyDeleteRowRange(requestId: string, offset: number, count: number, panel: vscode.WebviewPanel): void {
		if (this.rejectIfSaving(requestId, panel)) {
			return;
		}
		this.editController.applyDeleteRowRange(requestId, offset, count, panel);
	}

	public applySetHeaderContent(requestId: string, columnIndex: number, value: string, panel: vscode.WebviewPanel): void {
		if (this.rejectIfSaving(requestId, panel)) {
			return;
		}
		this.editController.applySetHeaderContent(requestId, columnIndex, value, panel);
	}

	public applyAddHeaderRow(requestId: string, columnCount: number, panel: vscode.WebviewPanel): void {
		if (this.rejectIfSaving(requestId, panel)) {
			return;
		}
		this.editController.applyAddHeaderRow(requestId, columnCount, panel);
	}

	/** Reject an edit that arrives mid-save (the change overlay must stay stable during the write). */
	private rejectIfSaving(requestId: string, panel: vscode.WebviewPanel): boolean {
		if (!this.isSaving) {
			return false;
		}

		this.postMessage({ type: 'changeRejected', requestId, reason: 'Saving in progress' }, panel);
		return true;
	}

	public canUndo(): boolean {
		return this.editController.canUndo();
	}

	public canRedo(): boolean {
		return this.editController.canRedo();
	}

	/** Undo the most recent change (driven by VS Code's undo via the provider). */
	public undoEdit(): void {
		this.editController.undoEdit();
	}

	/** Redo the most recently undone change. */
	public redoEdit(): void {
		this.editController.redoEdit();
	}

	public hasUnsavedChanges(): boolean {
		return this.changes.hasChanges();
	}

	/** Discard all pending changes without touching the file (the file was never modified). */
	public revert(): void {
		this.changes.clear();
		this.pageService.clearCaches();
		this.postHeaders();
		this.broadcastStatistics();
		this.broadcastChangeApplied('revert', 0, { startRowIndex: 0, endRowIndex: null });
	}

	// --- Save ---

	/**
	 * Materialize the change log into the file, then clear the log and re-index the saved file.
	 * Reports overall progress to the webview across two bands — the write (0–{@link SAVE_REINDEX_BAND_START}%)
	 * and the re-index ({@link SAVE_REINDEX_BAND_START}–100%) — so the toolbar can show a progress bar.
	 */
	public save(): Promise<void> {
		return this.enqueue(() => this.saveInternal());
	}

	private async saveInternal(): Promise<void> {
		// Nothing pending — a save would needlessly rewrite (and possibly re-normalize) an unmodified
		// file. Skip the write/re-index entirely so saving only runs when the document is dirty. A
		// second save queued behind a first also lands here as a no-op (the first cleared the log).
		if (!this.hasUnsavedChanges()) {
			return;
		}

		this.isSaving = true;
		this.lastSavePercent = -1;
		this.postMessage({ type: 'saveStarted' });
		try {
			// An added header is written as the file's new first physical row; from now on the file
			// genuinely has a header, so flip hasHeader before re-indexing (otherwise that line would be
			// re-read as data row 0). Captured before clear() since the flag lives in the change log.
			const savedInsertedHeader = this.changes.hasInsertedHeader();
			await writeCsvAndReplaceWithProgress(this.uri.fsPath, this.createWriteSource(), (rowsWritten, totalRows) => {
				const fraction = totalRows > 0 ? rowsWritten / totalRows : 1;
				this.reportSavePercent(fraction * SAVE_REINDEX_BAND_START);
			});
			this.changes.clear();
			if (savedInsertedHeader && this.csvFileConfig !== null && !this.csvFileConfig.hasHeader) {
				this.csvFileConfig = { ...this.csvFileConfig, hasHeader: true };
				this.reader.setOpenConfig(this.csvFileConfig);
			}
			this.pageService.clearCaches();
			await this.reindex(stats => {
				const fraction = stats.totalSizeInBytes > 0 ? stats.totalBytesRead / stats.totalSizeInBytes : 1;
				this.reportSavePercent(SAVE_REINDEX_BAND_START + fraction * (100 - SAVE_REINDEX_BAND_START));
			});
			if (savedInsertedHeader) {
				this.postHeaders(); // re-index now reads the prepended line as the header; push it to the webview
			}
			this.broadcastStatistics();
			this.broadcastChangeApplied('save', 0, { startRowIndex: 0, endRowIndex: null });
		} finally {
			this.isSaving = false;
			this.postMessage({ type: 'saveComplete' });
		}
	}

	/** Post an overall save percentage (0–100), throttled so only whole-percent changes are sent. */
	private reportSavePercent(percent: number): void {
		const clamped = Math.max(0, Math.min(100, Math.round(percent)));
		if (clamped === this.lastSavePercent) {
			return;
		}

		this.lastSavePercent = clamped;
		this.postMessage({ type: 'saveProgress', percent: clamped });
	}

	/** Apply user-selected config overrides and re-index the file. */
	public applyConfigChange(msg: SetCsvConfigMessage): Promise<void> {
		return this.enqueue(() => this.applyConfigChangeInternal(msg));
	}

	private async applyConfigChangeInternal(msg: SetCsvConfigMessage): Promise<void> {
		const newConfig: CsvFileConfig = {
			...this.csvFileConfig!,
			separator: msg.separator,
			encoding: msg.encoding,
			lineEnding: msg.lineEnding,
			hasHeader: msg.hasHeader,
		};
		this.csvFileConfig = newConfig;
		this.reader.setOpenConfig(newConfig);
		this.pageService.clearCaches();
		this.baseHeaderCells = null;
		this.headerConfig = null;
		try {
			await this.reindex();
		} catch (error) {
			this.handleLoadError(error);
			return;
		}
		// Persist after re-indexing so baseHeaderCells reflects the new config (needed for 'generalize').
		this.persistConfig(newConfig, msg.savingOption);
		this.broadcastStatistics();
		this.broadcastChangeApplied('config-change', 0, { startRowIndex: 0, endRowIndex: null });
		if (newConfig.hasHeader) {
			this.postHeaders();
		} else {
			this.postEmptyHeaders(newConfig);
		}
	}

	/** Write the current virtual content to a different destination, leaving the original untouched. */
	public saveAs(destination: vscode.Uri): Promise<void> {
		// writeCsv runs synchronously (no interleaving once it starts), but queue it anyway so a save or
		// config change can't re-index the reader between this call and the write actually beginning.
		return this.enqueue(async () => writeCsv(destination.fsPath, this.createWriteSource()));
	}

	/**
	 * Run `op` after every previously enqueued operation has settled, so reader/overlay mutations and
	 * reads never interleave (see {@link opChain}). The returned promise mirrors `op`'s own result; a
	 * rejection is isolated from the chain so it does not block later operations.
	 */
	private enqueue<T>(op: () => Promise<T>): Promise<T> {
		const run = this.opChain.then(op, op);
		this.opChain = run.then(() => undefined, () => undefined);
		return run;
	}

	// --- Backup / hot exit ---

	public serializeBackup(): CsvDocumentBackup {
		const snapshot = this.changes.serialize();
		return { log: snapshot.log, nextChangeId: snapshot.nextChangeId, isEditable: this.editController.isEditMode() };
	}

	public restoreBackup(backup: CsvDocumentBackup): void {
		this.changes.restore({ log: backup.log, nextChangeId: backup.nextChangeId });
		this.editController.restoreEditable(backup.isEditable);
		this.pageService.clearCaches();
	}

	public dispose(): void {
		this.isDisposed = true;
		this.reader.dispose();
		this.findController.dispose();
		this.broadcaster.clear();
		this.pageService.dispose();
		this.editController.dispose();
	}

	/** Post the header row (with any header-cell edits applied) to one panel, or broadcast to all. */
	private postHeaders(panel?: vscode.WebviewPanel): void {
		const config = this.csvFileConfig;
		if (config === null) {
			return;
		}

		// A real (file-backed) header takes precedence over any inserted header so the two never coexist.
		if (config.hasHeader === true) {
			if (this.baseHeaderCells === null || this.headerConfig === null) {
				return;
			}

			this.postMessage({
				type: 'headers',
				cells: this.changes.decorateHeader(this.baseHeaderCells),
				config: this.headerConfig
			}, panel);
			return;
		}

		// A header added to a header-less file: post the raw cells (empties preserved); the webview
		// renders empty cells as column_N.
		const insertedCells = this.changes.getInsertedHeaderCells();
		if (insertedCells !== null) {
			this.postMessage({
				type: 'headers',
				cells: insertedCells,
				config,
				headerInserted: true
			}, panel);
			return;
		}

		this.postEmptyHeaders(config, panel);
	}

	/** Effective header cells (real or inserted, with edits applied; empties preserved), or null if header-less. */
	public getEffectiveHeaderCells(): string[] | null {
		if (this.csvFileConfig?.hasHeader === true) {
			return this.baseHeaderCells === null ? null : this.changes.decorateHeader(this.baseHeaderCells);
		}
		return this.changes.getInsertedHeaderCells();
	}

	// --- Export ---

	/** The read-only port the export service drives (rows, header, config, final-state, filter scans). */
	public createExportHost(): ExportDocumentHost {
		return {
			readVirtualRows: (offset, count) => this.rowView.readVirtualRows(offset, count),
			getDisplayedReadableRowCount: () => this.rowView.getDisplayedReadableRowCount(),
			getEffectiveHeaderCells: () => this.getEffectiveHeaderCells(),
			getConfig: () => this.reader.getConfig(),
			isIndexingFinal: () => this.latestStats?.isFinal === true,
			runExclusive: read => this.enqueue(read),
			createFilterScanReader: (filter: ExportFilterDefinition) => new CsvSearchReader(
				this.reader,
				filter.query,
				{ matchCase: filter.matchCase, regex: filter.regex, wholeWord: filter.wholeWord },
				{
					initialRowsExpected: 0,
					startFromRow: 0,
					selectedColumns: filter.selectedColumns,
					readRows: (offset, count) => this.rowView.readVirtualRows(offset, count)
				}
			)
		};
	}

	/** The read-only port the DuckDB tool drives: the parse config to mirror, and a save to flush edits. */
	public createDuckDbHost(): DuckDbDocumentHost {
		return {
			getConfig: () => this.reader.getConfig(),
			save: () => this.save()
		};
	}

	/** Post the export capability descriptors + detected default column types to a panel (sent at init). */
	public postExportCapabilities(panel?: vscode.WebviewPanel): void {
		this.postMessage({
			type: 'exportCapabilities',
			exporters: getExporterDescriptors(),
			defaultColumnTypes: this.computeExportDefaultColumnTypes()
		}, panel);
	}

	/** Sample the start of the file and classify each column (TEXT / INTEGER / DECIMAL) to seed typing. */
	private computeExportDefaultColumnTypes(): ExportDefaultColumnType[] {
		const config = this.reader.getConfig();
		if (config === null) {
			return [];
		}

		const readable = this.reader.getReadableRowCount();
		if (readable <= 0) {
			return [];
		}

		const headerRows = config.hasHeader ? 1 : 0;
		const sampleRows = this.reader.readRange(0, Math.min(readable, EXPORT_TYPE_SAMPLE_ROWS + headerRows));
		return detectColumnDataTypes(sampleRows, config.separator, { hasHeader: config.hasHeader }).map((dataType, columnIndex) => ({
			columnIndex,
			baseType: dataType.type === ColumnType.INTEGER ? 'integer' : dataType.type === ColumnType.DECIMAL ? 'decimal' : 'text',
			locale: dataType.locale
		}));
	}

	private postEmptyHeaders(config: CsvFileConfigMessage, panel?: vscode.WebviewPanel): void {
		this.postMessage({
			type: 'headers',
			cells: [],
			config
		}, panel);
	}

	private broadcastChangeApplied(requestId: string, changeId: number, invalidatedRange: InvalidatedRange): void {
		this.postMessage({ type: 'changeApplied', requestId, changeId, invalidatedRange });
	}

	private broadcastStatistics(): void {
		if (this.latestStats !== null) {
			this.postStatistics(this.latestStats);
		}
	}

	/** Assemble everything CsvWriter needs to materialize the current virtual document. */
	private createWriteSource(): CsvWriteSource {
		const config = this.reader.getConfig();
		if (config === null) {
			throw new Error('Cannot save before CSV configuration is available');
		}

		return {
			config,
			totalRows: this.rowView.getDisplayedReadableRowCount(),
			originalPath: this.uri.fsPath,
			pageSize: INITIAL_PAGE_ROW_COUNT,
			changes: this.changes,
			readPhysical: (physicalRow, count) => this.reader.readRange(physicalRow, count),
			displayedToPhysical: displayedRow => this.rowView.displayedToPhysical(displayedRow)
		};
	}

	private reindex(onStats?: (stats: CsvMappingReaderStats) => void): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.latestLoadErrorReason = null;
			const handleStats = (stats: CsvMappingReaderStats): void => onStats?.(stats);
			const cleanup = (): void => {
				this.reader.off('end', handleEnd);
				this.reader.off('error', handleError);
				if (onStats !== undefined) {
					this.reader.off('stats', handleStats);
				}
			};
			const handleEnd = (stats: CsvMappingReaderStats): void => {
				cleanup();
				this.latestStats = stats;
				resolve();
			};
			const handleError = (error: Error): void => {
				cleanup();
				reject(error);
			};

			if (onStats !== undefined) {
				this.reader.on('stats', handleStats);
			}
			this.reader.once('end', handleEnd);
			this.reader.once('error', handleError);
			this.reader.open(this.uri.fsPath);
		});
	}

	private handleLoadError(error: unknown): CsvLoadErrorReason {
		const reason = error instanceof CsvMappingReaderError
			? error.reason
			: CsvLoadErrorReason.Unknown;
		this.latestLoadErrorReason = reason;
		this.log(`CSV load failed: reason=${reason}, details=${error instanceof Error ? error.message : String(error)}`);
		this.postLoadError(reason);
		return reason;
	}

	private postLoadError(reason: CsvLoadErrorReason, panel?: vscode.WebviewPanel): void {
		this.postMessage({ type: 'error', reason }, panel);
	}

	/** Build the port the find subsystem reads rows and posts messages through (see FindHost). */
	private createFindHost(): FindHost {
		return {
			reader: this.reader,
			pageSize: INITIAL_PAGE_ROW_COUNT,
			readVirtualRows: (offset, rowCount) => this.rowView.readVirtualRows(offset, rowCount),
			readDisplayedRows: (offset, rowCount) => this.rowView.readDisplayedRows(offset, rowCount),
			canReadDisplayedRange: (offset, rowCount) => this.rowView.canReadDisplayedRange(offset, rowCount),
			getDisplayedReadableRowCount: () => this.rowView.getDisplayedReadableRowCount(),
			getConfig: () => this.reader.getConfig(),
			getCachedPage: (offset, rowCount, panel) => this.pageService.getCachedPage(offset, rowCount, panel),
			isIndexingFinal: () => this.latestStats?.isFinal === true,
			isDisposed: () => this.isDisposed,
			post: (message, panel) => this.postMessage(message, panel)
		};
	}

	/** Build the port the paging service reads rows and posts pages through (see PageHost). */
	private createPageHost(): PageHost {
		return {
			getPanels: () => this.broadcaster.getPanels(),
			post: (message, panel) => this.postMessage(message, panel),
			readVirtualRows: (offset, rowCount) => this.rowView.readVirtualRows(offset, rowCount),
			canReadDisplayedRange: (offset, rowCount) => this.rowView.canReadDisplayedRange(offset, rowCount),
			getDisplayedReadableRowCount: () => this.rowView.getDisplayedReadableRowCount(),
			getConfig: () => this.reader.getConfig(),
			isDisposed: () => this.isDisposed,
			isIndexingFinal: () => this.latestStats?.isFinal === true,
			postEditMode: panel => this.postMessage({ type: 'editMode', isEditable: this.editController.isEditMode() }, panel),
			tryServeFilteredPage: (requestId, offset, rowCount, panel) => this.findController.tryServeFilteredPage(requestId, offset, rowCount, panel),
			getSearchPayloadForPage: (panel, page) => this.findController.getSearchPayloadForPage(panel, page),
			log: message => this.log(message)
		};
	}

	/** Build the port the edit controller emits its side effects through (see EditHost). */
	private createEditHost(): EditHost {
		return {
			post: (message, panel) => this.postMessage(message, panel),
			clearPageCaches: () => this.pageService.clearCaches(),
			broadcastStatistics: () => this.broadcastStatistics(),
			refreshHeaders: () => this.postHeaders(),
			isIndexingFinal: () => this.latestStats?.isFinal === true,
			canEditHeader: () => (this.csvFileConfig?.hasHeader === true && this.baseHeaderCells !== null) || this.changes.hasInsertedHeader(),
			log: message => this.log(message)
		};
	}

	private postStatistics(stats: CsvMappingReaderStats, panel?: vscode.WebviewPanel): void {
		this.log(`Sending statistics to webview: rows=${stats.rowCount}, bytes=${stats.totalBytesRead}/${stats.totalSizeInBytes}, final=${stats.isFinal}`);
		const header = this.csvFileConfig?.hasHeader === true ? 1 : 0;
		this.postMessage({
			type: 'statistics',
			rowCount: this.rowView.displayedRowCountFor(stats.rowCount),
			readableRowCount: Math.max(0, stats.readableRowCount - header + this.changes.getRowCountDelta()),
			totalBytesRead: stats.totalBytesRead,
			totalSizeInBytes: stats.totalSizeInBytes,
			config: stats.config,
			isFinal: stats.isFinal
		}, panel);
	}

	private postMessage(message: ExtensionToWebviewMessage, panel?: vscode.WebviewPanel): void {
		this.broadcaster.post(message, panel);
	}
}

/** Read up to `maxBytes` from the start of a file (used to detect headers before the reader opens). */
function readFirstBytes(filepath: string, maxBytes: number): Buffer {
	const fd = fs.openSync(filepath, 'r');
	try {
		const size = fs.fstatSync(fd).size;
		const length = Math.min(size, maxBytes);
		if (length <= 0) {
			return Buffer.alloc(0);
		}

		const buffer = Buffer.allocUnsafe(length);
		const bytesRead = fs.readSync(fd, buffer, 0, length, 0);
		return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
	} finally {
		fs.closeSync(fd);
	}
}
