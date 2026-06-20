import { CsvDocumentChanges } from '../../../src/CsvDocumentChanges';
import { DecimalSeparator } from '../../../src/csv/DataTypes';
import { ColumnType, detectColumnDataTypes } from '../../../src/csv/detectColumnDataTypes';
import { createFieldFormatter } from '../../../src/export/fieldFormatter';
import { getExporter, getExporterDescriptors, kindOfType } from '../../../src/export/registry';
import type { ExportColumn } from '../../../src/export/types';
import { materializeHeaderNames } from '../../../src/shared/headerLabels';
import { CsvLoadErrorReason } from '../../../src/shared/messages/errors';
import type { ExportColumnType, ExportDefaultColumnType, ExportRequestMessage } from '../../../src/shared/messages/export';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../../../src/shared/messages/protocol';
import type { FilteredRowData, FindMatchMessage, FindOptionsMessage, FindRequestMessage, FindVisibleRange } from '../../../src/shared/messages/find';
import type { InvalidatedRange } from '../../../src/shared/messages/editing';
import { createDefaultFaults, type EmulatorFaults } from './emulatorFaults';
import { loadFixtureCsv } from './loadFixtureCsv';

const PAGE_SIZE = 1000;
/** Fallback streamed-first-page size when the webview omits initialRowsExpected (mirrors FilterScan). */
const DEFAULT_FILTER_INITIAL_ROWS = 200;

export interface ExtensionEmulator {
	handleWebviewMessage(message: WebviewToExtensionMessage): void;
	reloadFixture(): Promise<void>;
	sendCommand(type: 'showFind' | 'findNext' | 'findPrevious' | 'closeFind'): void;
	sendError(reason: CsvLoadErrorReason): void;
	/** Dev-only fault injection: a snapshot of the current simulated-error toggles. */
	getFaults(): EmulatorFaults;
	/** Dev-only fault injection: flip one simulated-error toggle (or the load-error reason). */
	setFault<K extends keyof EmulatorFaults>(key: K, value: EmulatorFaults[K]): void;
	/** Dev-only: production undo/redo/save run through the VS Code host, which the browser lacks. */
	undo(): void;
	redo(): void;
	save(): void;
}

interface SearchState {
	searchSessionId: string;
	query: string;
	options: FindOptionsMessage;
}

/** Active filter-mode session: the matching source rows plus their cells, in scan order. */
interface FilterState {
	searchSessionId: string;
	query: string;
	options: FindOptionsMessage;
	/** Source (displayed) row offsets that matched, in scan order â€” the filtered grid's row numbers. */
	matchingRows: number[];
	/** Cells for each matching row, parallel to matchingRows. */
	rows: string[][];
}

interface Matcher {
	findMatches(value: string): Array<{ start: number; end: number }>;
}

export function createExtensionEmulator(): ExtensionEmulator {
	let fixtureRows: string[][] = [];
	let headers: string[] = [];
	let rows: string[][] = [];
	let fixturePromise: Promise<void> | null = null;
	let searchState: SearchState | null = null;
	let filterState: FilterState | null = null;
	let csvConfig = createDefaultConfig();
	const faults = createDefaultFaults();

	// Remembered UI selections (see src/shared/messages/memory.ts). The browser harness has one
	// fixture "file", so a single per-file map suffices; both maps persist across Reload Fixture.
	const rememberedGlobal: Record<string, unknown> = {};
	const rememberedFile: Record<string, unknown> = {};

	// Reuse the real overlay engine so dev mode mirrors the extension's editing behavior exactly.
	const changes = new CsvDocumentChanges();
	let isEditable = false;

	const readBase = (baseStart: number, length: number): string[][] =>
		rows.slice(baseStart, baseStart + length).map(row => row.slice());

	function virtualRowCount(): number {
		return Math.max(0, rows.length + changes.getRowCountDelta());
	}

	function readVirtualRows(offset: number, rowCount: number): string[][] {
		const available = Math.max(0, Math.min(rowCount, virtualRowCount() - offset));
		return changes.readRows(offset, available, readBase);
	}

	function applyHeaderConfig(): void {
		headers = csvConfig.hasHeader ? fixtureRows[0] ?? [] : [];
		rows = csvConfig.hasHeader ? fixtureRows.slice(1) : fixtureRows.slice();
		refreshSearchRows();
	}

	async function ensureFixtureLoaded(): Promise<void> {
		if (fixturePromise === null) {
			fixturePromise = loadFixtureCsv().then(loadedRows => {
				fixtureRows = loadedRows;
				applyHeaderConfig();
			});
		}

		await fixturePromise;
	}

	async function reloadFixture(): Promise<void> {
		fixturePromise = null;
		changes.clear();
		searchState = null;
		filterState = null;
		isEditable = false;
		await ensureFixtureLoaded();
		if (faults.loadError) {
			sendError(faults.loadErrorReason);
			console.debug('Fixture reload rejected by simulated load error');
			return;
		}
		sendHeaders();
		sendStatistics();
		sendEditMode();
		sendExportCapabilities();
		sendRememberedState();
		sendRows('reload:0', 0, Math.min(PAGE_SIZE, virtualRowCount()));
		console.debug('Fixture reloaded');
	}

	function handleWebviewMessage(message: WebviewToExtensionMessage): void {
		if (message.type === 'log') {
			console[message.level === 'error' ? 'error' : 'debug'](`[webview] ${message.message}`, message.data ?? '');
			return;
		}

		if (message.type === 'loaded-ready') {
			console.debug('Emulator received loaded-ready message with offset', message.offset, 'and rowCount', message.rowCount);
			void ensureFixtureLoaded()
				.then(() => {
					if (faults.loadError) {
						sendError(faults.loadErrorReason);
						return;
					}
					sendHeaders();
					sendStatistics();
					sendEditMode();
					sendExportCapabilities();
					sendRememberedState();
					sendPage(message.offset, message.rowCount);
				})
				.catch(() => sendError(CsvLoadErrorReason.Unknown));
			return;
		}

		if (message.type === 'requestRows') {
			console.debug('Emulator received requestRows message with requestId', message.requestId, 'offset', message.offset, 'and rowCount', message.rowCount);
			void ensureFixtureLoaded()
				.then(() => {
					if (filterState !== null) {
						serveFilteredRows(message.requestId, message.offset, message.rowCount);
						return;
					}
					if (faults.rowRequestError) {
						sendError(CsvLoadErrorReason.Unknown);
						return;
					}
					sendRows(message.requestId, message.offset, message.rowCount);
				})
				.catch(() => sendError(CsvLoadErrorReason.Unknown));
			return;
		}

		if (message.type === 'requestPage') {
			// Legacy paging path (the current webview pages via requestRows); kept so the exchange is covered.
			console.debug('Emulator received requestPage message with offset', message.offset, 'and rowCount', message.rowCount);
			void ensureFixtureLoaded()
				.then(() => {
					if (faults.rowRequestError) {
						sendError(CsvLoadErrorReason.Unknown);
						return;
					}
					sendPage(message.offset, message.rowCount);
				})
				.catch(() => sendError(CsvLoadErrorReason.Unknown));
			return;
		}

		if (message.type === 'exportRequest') {
			void ensureFixtureLoaded()
				.then(() => handleExportRequest(message))
				.catch(error => dispatchToWebview({ type: 'exportError', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) }));
			return;
		}

		if (message.type === 'setEditMode') {
			isEditable = message.editable; // The emulator is always "final", so editing can be enabled immediately.
			sendEditMode();
			return;
		}

		if (message.type === 'setCellContent') {
			void ensureFixtureLoaded()
				.then(() => applySetCellContent(message.requestId, message.rowIndex, message.columnIndex, message.value))
				.catch(() => sendError(CsvLoadErrorReason.Unknown));
			return;
		}

		if (message.type === 'insertRow') {
			void ensureFixtureLoaded()
				.then(() => applyInsertRow(message.requestId, message.rowIndex))
				.catch(() => sendError(CsvLoadErrorReason.Unknown));
			return;
		}

		if (message.type === 'deleteRowRange') {
			void ensureFixtureLoaded()
				.then(() => applyDeleteRowRange(message.requestId, message.offset, message.count))
				.catch(() => sendError(CsvLoadErrorReason.Unknown));
			return;
		}

		if (message.type === 'setHeaderContent') {
			void ensureFixtureLoaded()
				.then(() => applySetHeaderContent(message.requestId, message.columnIndex, message.value))
				.catch(() => sendError(CsvLoadErrorReason.Unknown));
			return;
		}

		if (message.type === 'addHeaderRow') {
			void ensureFixtureLoaded()
				.then(() => applyAddHeaderRow(message.requestId, message.columnCount))
				.catch(() => sendError(CsvLoadErrorReason.Unknown));
			return;
		}

		if (message.type === 'setCsvConfig') {
			console.debug('Emulator received setCsvConfig message with savingOption', message.savingOption ?? 'none');
			void ensureFixtureLoaded()
				.then(() => {
					if (faults.configError) {
						sendError(CsvLoadErrorReason.Unknown);
						return;
					}
					csvConfig = {
						...csvConfig,
						separator: message.separator,
						encoding: message.encoding,
						lineEnding: message.lineEnding,
						hasHeader: message.hasHeader
					};
					applyHeaderConfig();
					sendStatistics();
					dispatchToWebview({ type: 'changeApplied', requestId: 'config-change', changeId: 0, invalidatedRange: { startRowIndex: 0, endRowIndex: null } });
					sendHeaders();
				})
				.catch(() => sendError(CsvLoadErrorReason.Unknown));
			return;
		}

		if (message.type === 'checkDuckDb') {
			console.debug('Emulator received checkDuckDb');
			dispatchToWebview({ type: 'duckDbStatus', path: 'duckdb', exists: true, isExecutable: true, origin: 'default-path' });
			return;
		}

		if (message.type === 'runDuckDb') {
			// The browser dev harness can't spawn a terminal; just acknowledge the request so the
			// round-trip is visible while iterating on the Tools panel.
			console.debug(`Emulator received runDuckDb: tableKind=${message.tableKind}, tableName=${JSON.stringify(message.tableName)}, decimalSeparator=${JSON.stringify(message.decimalSeparator)}`);
			return;
		}

		if (message.type === 'setMemory') {
			const target = message.scope === 'global' ? rememberedGlobal : rememberedFile;
			target[message.key] = message.value;
			console.debug(`Emulator stored ${message.scope} memory: ${message.key}`);
			return;
		}

		if (message.type === 'findRequest') {
			void ensureFixtureLoaded()
				.then(() => handleFindRequest(message))
				.catch(error => sendSearchStatus(message.searchSessionId, 'error', error instanceof Error ? error.message : String(error)));
		}
	}

	function applySetCellContent(requestId: string, rowIndex: number, columnIndex: number, value: string): void {
		if (injectEditFault(requestId) || !ensureEditable(requestId)) {
			return;
		}

		if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex) || rowIndex < 0 || columnIndex < 0 || rowIndex >= virtualRowCount()) {
			rejectChange(requestId, 'Target cell is out of range');
			return;
		}

		const change = changes.setCellContent(rowIndex, columnIndex, value);
		afterChange(requestId, change.changeId, { startRowIndex: rowIndex, endRowIndex: rowIndex });
	}

	function applyInsertRow(requestId: string, rowIndex: number): void {
		if (injectEditFault(requestId) || !ensureEditable(requestId)) {
			return;
		}

		if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex > virtualRowCount()) {
			rejectChange(requestId, 'Insertion point is out of range');
			return;
		}

		const change = changes.insertRow(rowIndex);
		afterChange(requestId, change.changeId, { startRowIndex: rowIndex, endRowIndex: null });
	}

	function applySetHeaderContent(requestId: string, columnIndex: number, value: string): void {
		if (injectEditFault(requestId) || !ensureEditable(requestId)) {
			return;
		}

		if (!csvConfig.hasHeader && !changes.hasInsertedHeader()) {
			rejectChange(requestId, 'This file has no header row to edit');
			return;
		}

		if (!Number.isInteger(columnIndex) || columnIndex < 0) {
			rejectChange(requestId, 'Target header is out of range');
			return;
		}

		const change = changes.setHeaderContent(columnIndex, value);
		sendHeaders(); // header edits touch no data rows; refresh the header
		dispatchToWebview({ type: 'changeApplied', requestId, changeId: change.changeId, invalidatedRange: { startRowIndex: 0, endRowIndex: -1 } });
	}

	function applyAddHeaderRow(requestId: string, columnCount: number): void {
		if (injectEditFault(requestId) || !ensureEditable(requestId)) {
			return;
		}

		if (csvConfig.hasHeader || changes.hasInsertedHeader()) {
			rejectChange(requestId, 'This file already has a header row');
			return;
		}

		if (!Number.isInteger(columnCount) || columnCount <= 0) {
			rejectChange(requestId, 'Invalid header column count');
			return;
		}

		// No sendHeaders: the paired setHeaderContent refreshes the populated header (mirrors the extension).
		const change = changes.insertHeader(new Array<string>(columnCount).fill(''));
		dispatchToWebview({ type: 'changeApplied', requestId, changeId: change.changeId, invalidatedRange: { startRowIndex: 0, endRowIndex: -1 } });
	}

	function applyDeleteRowRange(requestId: string, offset: number, count: number): void {
		if (injectEditFault(requestId) || !ensureEditable(requestId)) {
			return;
		}

		if (!Number.isInteger(offset) || !Number.isInteger(count) || offset < 0 || count <= 0 || offset + count > virtualRowCount()) {
			rejectChange(requestId, 'Row range is out of range');
			return;
		}

		const change = changes.deleteRowRange(offset, count);
		afterChange(requestId, change.changeId, { startRowIndex: offset, endRowIndex: null });
	}

	function ensureEditable(requestId: string): boolean {
		if (!isEditable) {
			rejectChange(requestId, 'Document is read-only');
			return false;
		}

		return true;
	}

	function rejectChange(requestId: string, reason: string): void {
		dispatchToWebview({ type: 'changeRejected', requestId, reason });
	}

	/** When the edit-write fault is on, reject every edit so the webview's rollback path can be tested. */
	function injectEditFault(requestId: string): boolean {
		if (faults.editError) {
			rejectChange(requestId, 'Simulated extension failure while applying edit');
			return true;
		}

		return false;
	}

	function afterChange(requestId: string, changeId: number, invalidatedRange: InvalidatedRange): void {
		refreshSearchRows();
		sendStatistics();
		dispatchToWebview({ type: 'changeApplied', requestId, changeId, invalidatedRange });
	}

	function undo(): void {
		const result = changes.undo();
		if (result === null) {
			return;
		}

		if (result.change.type === 'set-header-content' || result.change.type === 'insert-header' || result.change.type === 'remove-header') {
			sendHeaders();
		}
		refreshSearchRows();
		sendStatistics();
		dispatchToWebview({ type: 'changeApplied', requestId: 'undo', changeId: result.change.changeId, invalidatedRange: result.invalidatedRange });
	}

	function redo(): void {
		const result = changes.redo();
		if (result === null) {
			return;
		}

		if (result.change.type === 'set-header-content' || result.change.type === 'insert-header' || result.change.type === 'remove-header') {
			sendHeaders();
		}
		refreshSearchRows();
		sendStatistics();
		dispatchToWebview({ type: 'changeApplied', requestId: 'redo', changeId: result.change.changeId, invalidatedRange: result.invalidatedRange });
	}

	function save(): void {
		if (faults.slowSave) {
			simulateSlowSave();
			return;
		}

		finalizeSave();
	}

	/** Dev mode has no filesystem; clearing the log mimics a successful persist + re-index. */
	function finalizeSave(): void {
		// Mirror the extension: a header added to a header-less file is baked into the file as its new
		// first row (empties materialized to column_N), and the file is henceforth treated as headed.
		const insertedForSave = changes.getInsertedHeaderCells();
		if (insertedForSave !== null && !csvConfig.hasHeader) {
			fixtureRows = [materializeHeaderNames(insertedForSave, insertedForSave.length), ...fixtureRows];
			csvConfig = { ...csvConfig, hasHeader: true };
			applyHeaderConfig();
		}

		changes.clear();
		sendHeaders();
		refreshSearchRows();
		sendStatistics();
		dispatchToWebview({ type: 'changeApplied', requestId: 'save', changeId: 0, invalidatedRange: { startRowIndex: 0, endRowIndex: null } });
		console.debug('Emulator saved (in-memory log cleared)');
	}

	/** Stream saveStarted â†’ saveProgress ticks â†’ saveComplete over ~1.5s so the toolbar save bar shows. */
	function simulateSlowSave(): void {
		dispatchToWebview({ type: 'saveStarted' });
		let percent = 0;
		const interval = setInterval(() => {
			percent += 10;
			if (percent >= 100) {
				clearInterval(interval);
				dispatchToWebview({ type: 'saveProgress', percent: 100 });
				finalizeSave();
				dispatchToWebview({ type: 'saveComplete' });
				return;
			}

			dispatchToWebview({ type: 'saveProgress', percent });
		}, 150);
	}

	function refreshSearchRows(): void {
		setEmulatorRowsForSearch(readVirtualRows(0, virtualRowCount()));
	}

	function sendEditMode(): void {
		dispatchToWebview({ type: 'editMode', isEditable });
	}

	// --- Export (mirrors the extension's ExportService using the real, pure JSON encoder) ---

	function sendExportCapabilities(): void {
		dispatchToWebview({ type: 'exportCapabilities', exporters: getExporterDescriptors(), defaultColumnTypes: computeExportDefaultColumnTypes() });
	}

	function sendRememberedState(): void {
		dispatchToWebview({ type: 'rememberedState', global: { ...rememberedGlobal }, file: { ...rememberedFile } });
	}

	function computeExportDefaultColumnTypes(): ExportDefaultColumnType[] {
		if (fixtureRows.length === 0) {
			return [];
		}
		// detectColumnDataTypes wants raw line strings; the fixture is already split, so re-join it
		// (good enough for dev defaults â€” the user can override any column).
		const rawLines = fixtureRows.map(cells => cells.join(csvConfig.separator));
		return detectColumnDataTypes(rawLines, csvConfig.separator, { hasHeader: csvConfig.hasHeader }).map((dataType, columnIndex) => ({
			columnIndex,
			baseType: dataType.type === ColumnType.INTEGER ? 'integer' : dataType.type === ColumnType.DECIMAL ? 'decimal' : 'text',
			locale: dataType.locale
		}));
	}

	function handleExportRequest(message: ExportRequestMessage): void {
		const exporter = getExporter(message.format);
		if (exporter === undefined) {
			dispatchToWebview({ type: 'exportError', requestId: message.requestId, message: `Unsupported export format: ${message.format}.` });
			return;
		}

		const headerCells = csvConfig.hasHeader ? headers : [];
		const typeById = new Map<number, string>();
		const requestedTypes = Array.isArray(message.formatOptions.columnTypes) ? message.formatOptions.columnTypes as ExportColumnType[] : [];
		for (const entry of requestedTypes) {
			typeById.set(entry.columnIndex, entry.typeId);
		}
		const styleByColumn = new Map<number, typeof message.columnStyles[number]>();
		for (const style of message.columnStyles) {
			styleByColumn.set(style.columnIndex, style);
		}

		const columns: ExportColumn[] = message.columns.map(sourceIndex => {
			const typeId = typeById.get(sourceIndex) ?? 'text';
			const style = styleByColumn.get(sourceIndex);
			return {
				sourceIndex,
				name: (headerCells[sourceIndex] ?? '').trim(),
				typeId,
				kind: kindOfType(message.format, typeId),
				align: message.retainAlignment ? (style?.align ?? 'left') : 'left',
				foregroundColor: message.retainColors ? (style?.foregroundColor ?? null) : null,
				backgroundColor: message.retainColors ? (style?.backgroundColor ?? null) : null
			};
		});
		if (columns.length === 0) {
			dispatchToWebview({ type: 'exportError', requestId: message.requestId, message: 'Select at least one column to export.' });
			return;
		}

		const exportRows = resolveExportRows(message);
		const context = {
			columns,
			hasHeader: csvConfig.hasHeader,
			rowCount: exportRows.length,
			formatOptions: message.formatOptions,
			formatField: createFieldFormatter(columns, csvConfig.decimalSeparator as DecimalSeparator)
		};
		const encoder = exporter.createEncoder();

		try {
			let output = encoder.begin(context);
			let processed = 0;
			for (const row of exportRows) {
				output += encoder.encodeRow(columns.map(column => row[column.sourceIndex] ?? ''), processed, context);
				processed += 1;
				if (processed % PAGE_SIZE === 0) {
					dispatchToWebview({ type: 'exportProgress', requestId: message.requestId, rowsProcessed: processed, totalRows: exportRows.length });
				}
			}
			output += encoder.end(context);

			const byteCount = new TextEncoder().encode(output).length;
			if (message.destination === 'clipboard') {
				void navigator.clipboard?.writeText(output);
				dispatchToWebview({ type: 'exportComplete', requestId: message.requestId, destination: 'clipboard', rowCount: processed, byteCount });
				return;
			}

			const fileName = `export.${exporter.descriptor.fileExtension}`;
			downloadText(fileName, output);
			dispatchToWebview({ type: 'exportComplete', requestId: message.requestId, destination: 'file', rowCount: processed, byteCount, filePath: fileName });
		} catch (error) {
			dispatchToWebview({ type: 'exportError', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) });
		}
	}

	function resolveExportRows(message: ExportRequestMessage): string[][] {
		const allRows = readVirtualRows(0, virtualRowCount());
		if (message.scope !== 'filtered' || message.filter === undefined) {
			return allRows;
		}

		let matcher: Matcher;
		try {
			matcher = createMatcher(message.filter.query, {
				matchCase: message.filter.matchCase,
				wholeWord: message.filter.wholeWord,
				regex: message.filter.regex,
				selectedColumns: message.filter.selectedColumns
			});
		} catch {
			return [];
		}
		return allRows.filter(row => findMatchesInRows(0, [row], matcher, message.filter!.selectedColumns).length > 0);
	}

	function handleFindRequest(message: FindRequestMessage): void {
		if (faults.findError) {
			sendSearchStatus(message.searchSessionId, 'error', 'Simulated search engine failure');
			return;
		}

		if (message.action === 'close') {
			searchState = null;
			if (filterState !== null) {
				filterState = null;
				dispatchToWebview({ type: 'findUpdateClear', searchSessionId: message.searchSessionId });
			}
			dispatchToWebview({ type: 'searchClear', searchSessionId: message.searchSessionId });
			return;
		}

		// Leaving filter mode: tear down the streamed filter rows before falling through to navigate.
		if (filterState !== null && message.options.filterMode !== true) {
			filterState = null;
			dispatchToWebview({ type: 'findUpdateClear', searchSessionId: message.searchSessionId });
		}

		if (message.options.filterMode === true) {
			handleFilterRequest(message);
			return;
		}

		searchState = {
			searchSessionId: message.searchSessionId,
			query: message.query,
			options: message.options
		};

		if (message.query.length === 0) {
			dispatchToWebview({ type: 'searchMatches', searchSessionId: message.searchSessionId, range: normalizeRange(message.visibleRange), matches: [] });
			sendSearchStatus(message.searchSessionId, 'ready');
			return;
		}

		let matcher: Matcher;
		try {
			matcher = createMatcher(message.query, message.options);
		} catch (error) {
			sendSearchStatus(message.searchSessionId, 'error', error instanceof Error ? error.message : String(error));
			return;
		}

		const visibleRange = normalizeRange(message.visibleRange);
		dispatchToWebview({
			type: 'searchMatches',
			searchSessionId: message.searchSessionId,
			range: visibleRange,
			matches: findMatchesInRows(visibleRange.startRowIndex, getRowsForRange(visibleRange), matcher, message.options.selectedColumns)
		});

		if (message.action === 'next' || message.action === 'previous') {
			const result = findNavigationMatch(message, matcher);
			if (result === null) {
				sendSearchStatus(message.searchSessionId, 'noResults', 'No results');
				return;
			}

			dispatchToWebview({ type: 'searchMatches', searchSessionId: message.searchSessionId, range: result.range, matches: result.matches });
			dispatchToWebview({ type: 'searchCursor', searchSessionId: message.searchSessionId, match: result.match, wrapped: result.wrapped });
			sendSearchStatus(message.searchSessionId, result.wrapped ? 'wrapped' : 'ready', result.wrapped ? (message.action === 'next' ? 'Wrapped to top' : 'Wrapped to bottom') : undefined);
			return;
		}

		if (message.action === 'update') {
			const visibleMatches = findMatchesInRows(visibleRange.startRowIndex, getRowsForRange(visibleRange), matcher, message.options.selectedColumns);
			const match = visibleMatches.find(item => isAfterCursor(item, message.cursor)) ?? visibleMatches[0];
			if (match !== undefined) {
				dispatchToWebview({ type: 'searchCursor', searchSessionId: message.searchSessionId, match, wrapped: false });
				sendSearchStatus(message.searchSessionId, 'ready');
				return;
			}

			const result = findNavigationMatch(message, matcher);
			if (result === null) {
				sendSearchStatus(message.searchSessionId, 'noResults', 'No results');
				return;
			}

			dispatchToWebview({ type: 'searchMatches', searchSessionId: message.searchSessionId, range: result.range, matches: result.matches });
			dispatchToWebview({ type: 'searchCursor', searchSessionId: message.searchSessionId, match: result.match, wrapped: result.wrapped });
			sendSearchStatus(message.searchSessionId, result.wrapped ? 'wrapped' : 'ready', result.wrapped ? 'Wrapped to top' : undefined);
			return;
		}

		sendSearchStatus(message.searchSessionId, 'ready');
	}

	// --- Filter mode (mirrors the extension's FilterScan / CsvSearchReader, computed eagerly in-memory) ---

	function handleFilterRequest(message: FindRequestMessage): void {
		// next/previous within an unchanged filter session just moves the cursor over existing matches.
		if ((message.action === 'next' || message.action === 'previous')
			&& filterState !== null
			&& filterState.searchSessionId === message.searchSessionId) {
			sendSearchStatus(message.searchSessionId, 'searching');
			const result = findFilterNavigationMatch(filterState, message.action, message.cursor);
			if (result === null) {
				sendSearchStatus(message.searchSessionId, 'noResults', 'No results');
				return;
			}

			dispatchToWebview({ type: 'searchCursor', searchSessionId: message.searchSessionId, match: result.match, wrapped: result.wrapped });
			sendSearchStatus(message.searchSessionId, result.wrapped ? 'wrapped' : 'ready', result.wrapped ? (message.action === 'next' ? 'Wrapped to top' : 'Wrapped to bottom') : undefined);
			return;
		}

		startFilter(message);
	}

	/** Compute the full filtered set eagerly and stream the first page as a findUpdate. */
	function startFilter(message: FindRequestMessage): void {
		dispatchToWebview({ type: 'findUpdateClear', searchSessionId: message.searchSessionId });

		const allRows = readVirtualRows(0, virtualRowCount());
		const totalBytes = allRows.length; // dev byte proxy (statistics uses the same row-count proxy)

		if (message.query.length === 0) {
			filterState = { searchSessionId: message.searchSessionId, query: '', options: message.options, matchingRows: [], rows: [] };
			dispatchToWebview({ type: 'findUpdate', searchSessionId: message.searchSessionId, totalCount: 0, bytesProcessed: totalBytes, totalBytes, rows: [], isFinal: true });
			return;
		}

		let matcher: Matcher;
		try {
			matcher = createMatcher(message.query, message.options);
		} catch (error) {
			sendSearchStatus(message.searchSessionId, 'error', error instanceof Error ? error.message : String(error));
			return;
		}

		const selectedColumns = message.options.selectedColumns;
		const matchingRows: number[] = [];
		const rows: string[][] = [];
		const streamed: FilteredRowData[] = [];
		const initialRowsExpected = Math.max(0, message.initialRowsExpected ?? DEFAULT_FILTER_INITIAL_ROWS);

		for (let sourceOffset = 0; sourceOffset < allRows.length; sourceOffset++) {
			const gridIndex = matchingRows.length;
			// Single-row scan at rowOffset=gridIndex makes each match's rowIndex the filtered-grid index.
			const rowMatches = findMatchesInRows(gridIndex, [allRows[sourceOffset]], matcher, selectedColumns);
			if (rowMatches.length === 0) {
				continue;
			}

			matchingRows.push(sourceOffset);
			rows.push(allRows[sourceOffset]);
			if (streamed.length < initialRowsExpected) {
				streamed.push({ offset: sourceOffset, cells: allRows[sourceOffset], matches: rowMatches });
			}
		}

		filterState = { searchSessionId: message.searchSessionId, query: message.query, options: message.options, matchingRows, rows };
		dispatchToWebview({
			type: 'findUpdate',
			searchSessionId: message.searchSessionId,
			totalCount: matchingRows.length,
			bytesProcessed: totalBytes,
			totalBytes,
			rows: streamed,
			isFinal: true
		});
	}

	/** Serve a filtered grid page (rows beyond the streamed first page) as a rows message, or rows-unavailable. */
	function serveFilteredRows(requestId: string, gridOffset: number, rowCount: number): void {
		const state = filterState;
		if (state === null) {
			return;
		}

		const available = Math.min(gridOffset + rowCount, state.matchingRows.length) - gridOffset;
		if (faults.filterUnavailable || available <= 0) {
			dispatchToWebview({ type: 'rows-unavailable', requestId, offset: gridOffset, rowCount, readableRowCount: state.matchingRows.length, isFinal: true });
			return;
		}

		const pageRows = state.rows.slice(gridOffset, gridOffset + available);
		const rowNumbers = state.matchingRows.slice(gridOffset, gridOffset + available);

		if (state.query.length === 0) {
			dispatchToWebview({ type: 'rows', requestId, offset: gridOffset, rowCount: pageRows.length, rows: pageRows, rowNumbers });
			return;
		}

		let matches: FindMatchMessage[] = [];
		try {
			matches = findMatchesInRows(gridOffset, pageRows, createMatcher(state.query, state.options), state.options.selectedColumns);
		} catch {
			matches = [];
		}

		dispatchToWebview({
			type: 'rows',
			requestId,
			offset: gridOffset,
			rowCount: pageRows.length,
			rows: pageRows,
			rowNumbers,
			searchSessionId: state.searchSessionId,
			matches
		});
	}

	/** Jump to the next/previous match within the filtered grid, wrapping around the cursor row once. */
	function findFilterNavigationMatch(state: FilterState, direction: 'next' | 'previous', cursor: { rowIndex: number; cellIndex: number; charOffset: number }): { match: FindMatchMessage; wrapped: boolean } | null {
		const gridCount = state.matchingRows.length;
		if (gridCount === 0) {
			return null;
		}

		let matcher: Matcher;
		try {
			matcher = createMatcher(state.query, state.options);
		} catch {
			return null;
		}

		const cursorGridRow = clamp(cursor.rowIndex, 0, gridCount - 1);
		const tryRow = (gridIndex: number, wrapped: boolean): { match: FindMatchMessage; wrapped: boolean } | null => {
			const rowMatches = findMatchesInRows(gridIndex, [state.rows[gridIndex]], matcher, state.options.selectedColumns);
			if (rowMatches.length === 0) {
				return null;
			}

			const match = direction === 'next'
				? rowMatches.find(item => wrapped || isAfterCursor(item, cursor)) ?? (wrapped ? rowMatches[0] : undefined)
				: [...rowMatches].reverse().find(item => wrapped || isBeforeCursor(item, cursor)) ?? (wrapped ? rowMatches[rowMatches.length - 1] : undefined);
			return match === undefined ? null : { match, wrapped };
		};

		if (direction === 'next') {
			for (let index = cursorGridRow; index < gridCount; index++) {
				const result = tryRow(index, false);
				if (result !== null) {
					return result;
				}
			}
			for (let index = 0; index < cursorGridRow; index++) {
				const result = tryRow(index, true);
				if (result !== null) {
					return result;
				}
			}
			return null;
		}

		for (let index = cursorGridRow; index >= 0; index--) {
			const result = tryRow(index, false);
			if (result !== null) {
				return result;
			}
		}
		for (let index = gridCount - 1; index > cursorGridRow; index--) {
			const result = tryRow(index, true);
			if (result !== null) {
				return result;
			}
		}
		return null;
	}

	function sendHeaders(): void {
		if (csvConfig.hasHeader) {
			const decorated = changes.decorateHeader(headers);
			dispatchToWebview({ type: 'headers', cells: decorated, config: csvConfig });
			return;
		}

		const inserted = changes.getInsertedHeaderCells();
		if (inserted !== null) {
			dispatchToWebview({ type: 'headers', cells: inserted, config: csvConfig, headerInserted: true });
			return;
		}

		dispatchToWebview({ type: 'headers', cells: [], config: csvConfig });
	}

	function sendStatistics(): void {
		const count = virtualRowCount();
		console.debug('Emulator sending statistics message with rowCount', count);
		dispatchToWebview({
			type: 'statistics',
			rowCount: count,
			readableRowCount: count,
			totalBytesRead: count,
			totalSizeInBytes: count,
			isFinal: true,
			config: csvConfig
		});
	}

	function sendPage(offset: number, rowCount: number): void {
		const pageRows = readVirtualRows(offset, rowCount);
		dispatchToWebview({
			type: 'page',
			offset,
			rowCount: pageRows.length,
			rows: pageRows,
			...createSearchPayload(offset, pageRows)
		});
	}

	function sendRows(requestId: string, offset: number, rowCount: number): void {
		const pageRows = readVirtualRows(offset, rowCount);
		dispatchToWebview({
			type: 'rows',
			requestId,
			offset,
			rowCount: pageRows.length,
			rows: pageRows,
			...createSearchPayload(offset, pageRows)
		});
	}

	function createSearchPayload(offset: number, pageRows: string[][]): { searchSessionId?: string; matches?: FindMatchMessage[] } {
		if (searchState === null || searchState.query.length === 0) {
			return {};
		}

		try {
			const matcher = createMatcher(searchState.query, searchState.options);
			return {
				searchSessionId: searchState.searchSessionId,
				matches: findMatchesInRows(offset, pageRows, matcher, searchState.options.selectedColumns)
			};
		} catch {
			return { searchSessionId: searchState.searchSessionId, matches: [] };
		}
	}

	function sendSearchStatus(searchSessionId: string, status: 'ready' | 'searching' | 'noResults' | 'wrapped' | 'error', message?: string): void {
		dispatchToWebview({ type: 'searchStatus', searchSessionId, status, message });
	}

	function sendCommand(type: 'showFind' | 'findNext' | 'findPrevious' | 'closeFind'): void {
		dispatchToWebview({ type });
	}

	function sendError(reason: CsvLoadErrorReason): void {
		dispatchToWebview({ type: 'error', reason });
	}

	function getFaults(): EmulatorFaults {
		return { ...faults };
	}

	function setFault<K extends keyof EmulatorFaults>(key: K, value: EmulatorFaults[K]): void {
		faults[key] = value;
		console.debug('Emulator fault toggled', key, value);
	}

	return {
		handleWebviewMessage,
		reloadFixture,
		sendCommand,
		sendError,
		getFaults,
		setFault,
		undo,
		redo,
		save
	};
}

function findNavigationMatch(message: FindRequestMessage, matcher: Matcher): { match: FindMatchMessage; wrapped: boolean; range: FindVisibleRange; matches: FindMatchMessage[] } | null {
	if (rowsLength() === 0) {
		return null;
	}

	const cursorRow = clamp(message.cursor.rowIndex, 0, rowsLength() - 1);
	if (message.action === 'next') {
		return scanForward(message.cursor, matcher, message.options.selectedColumns, cursorRow, rowsLength() - 1, false)
			?? scanForward(message.cursor, matcher, message.options.selectedColumns, 0, cursorRow, true);
	}

	return scanBackward(message.cursor, matcher, message.options.selectedColumns, cursorRow, 0, false)
		?? scanBackward(message.cursor, matcher, message.options.selectedColumns, rowsLength() - 1, cursorRow, true);
}

let rowsForNavigation: string[][] | null = null;

function rowsLength(): number {
	return rowsForNavigation?.length ?? 0;
}

function getRowsForRange(range: FindVisibleRange): string[][] {
	return (rowsForNavigation ?? []).slice(range.startRowIndex, range.endRowIndex + 1);
}

function scanForward(cursor: { rowIndex: number; cellIndex: number; charOffset: number }, matcher: Matcher, selectedColumns: number[], startRow: number, endRow: number, wrapped: boolean) {
	for (let offset = startRow; offset <= endRow;) {
		const rowCount = Math.min(PAGE_SIZE, endRow - offset + 1);
		const range = { startRowIndex: offset, endRowIndex: offset + rowCount - 1 };
		const matches = findMatchesInRows(offset, getRowsForRange(range), matcher, selectedColumns);
		const match = matches.find(item => wrapped || isAfterCursor(item, cursor));
		if (match !== undefined) {
			return { match, wrapped, range, matches };
		}
		offset += rowCount;
	}
	return null;
}

function scanBackward(cursor: { rowIndex: number; cellIndex: number; charOffset: number }, matcher: Matcher, selectedColumns: number[], startRow: number, endRow: number, wrapped: boolean) {
	for (let chunkEnd = startRow; chunkEnd >= endRow;) {
		const offset = Math.max(endRow, chunkEnd - PAGE_SIZE + 1);
		const range = { startRowIndex: offset, endRowIndex: chunkEnd };
		const matches = findMatchesInRows(offset, getRowsForRange(range), matcher, selectedColumns);
		const match = [...matches].reverse().find(item => wrapped || isBeforeCursor(item, cursor));
		if (match !== undefined) {
			return { match, wrapped, range, matches };
		}
		chunkEnd = offset - 1;
	}
	return null;
}

function createDefaultConfig() {
	return {
		separator: ',',
		encoding: 'utf-8',
		lineEnding: '\n',
		decimalSeparator: 0,
		hasHeader: true
	};
}

function createMatcher(query: string, options: FindOptionsMessage): Matcher {
	if (query.length === 0) {
		return { findMatches: () => [] };
	}

	if (options.regex) {
		const regex = new RegExp(query, options.matchCase ? 'g' : 'gi');
		return { findMatches: value => findRegexMatches(value, regex, options.wholeWord) };
	}

	const needle = options.matchCase ? query : query.toLocaleLowerCase();
	return {
		findMatches(value) {
			const haystack = options.matchCase ? value : value.toLocaleLowerCase();
			const matches: Array<{ start: number; end: number }> = [];
			let start = 0;
			while (start <= haystack.length) {
				const index = haystack.indexOf(needle, start);
				if (index === -1) {
					break;
				}
				const end = index + query.length;
				if (!options.wholeWord || isWholeWordMatch(value, index, end)) {
					matches.push({ start: index, end });
				}
				start = index + Math.max(needle.length, 1);
			}
			return matches;
		}
	};
}

function findRegexMatches(value: string, regex: RegExp, wholeWord: boolean): Array<{ start: number; end: number }> {
	const matches: Array<{ start: number; end: number }> = [];
	regex.lastIndex = 0;
	while (true) {
		const match = regex.exec(value);
		if (match === null) {
			break;
		}
		if (match[0].length === 0) {
			regex.lastIndex += 1;
			continue;
		}
		const end = match.index + match[0].length;
		if (!wholeWord || isWholeWordMatch(value, match.index, end)) {
			matches.push({ start: match.index, end });
		}
	}
	return matches;
}

function findMatchesInRows(rowOffset: number, pageRows: string[][], matcher: Matcher, selectedColumns: number[]): FindMatchMessage[] {
	const matches: FindMatchMessage[] = [];
	const selectedColumnSet = selectedColumns.length > 0 ? new Set(selectedColumns) : null;
	for (let rowIndex = 0; rowIndex < pageRows.length; rowIndex++) {
		const row = pageRows[rowIndex];
		for (let cellIndex = 0; cellIndex < row.length; cellIndex++) {
			if (selectedColumnSet !== null && !selectedColumnSet.has(cellIndex)) {
				continue;
			}

			for (const match of matcher.findMatches(row[cellIndex])) {
				matches.push({ rowIndex: rowOffset + rowIndex, cellIndex, start: match.start, end: match.end });
			}
		}
	}
	return matches;
}

function normalizeRange(range: FindVisibleRange): FindVisibleRange {
	if (rowsLength() === 0) {
		return { startRowIndex: 0, endRowIndex: -1 };
	}
	const start = clamp(range.startRowIndex, 0, rowsLength() - 1);
	const end = clamp(range.endRowIndex, start, rowsLength() - 1);
	return { startRowIndex: start, endRowIndex: end };
}

function isAfterCursor(match: FindMatchMessage, cursor: { rowIndex: number; cellIndex: number; charOffset: number }): boolean {
	return match.rowIndex > cursor.rowIndex
		|| (match.rowIndex === cursor.rowIndex && match.cellIndex > cursor.cellIndex)
		|| (match.rowIndex === cursor.rowIndex && match.cellIndex === cursor.cellIndex && match.start >= cursor.charOffset);
}

function isBeforeCursor(match: FindMatchMessage, cursor: { rowIndex: number; cellIndex: number; charOffset: number }): boolean {
	return match.rowIndex < cursor.rowIndex
		|| (match.rowIndex === cursor.rowIndex && match.cellIndex < cursor.cellIndex)
		|| (match.rowIndex === cursor.rowIndex && match.cellIndex === cursor.cellIndex && match.start < cursor.charOffset);
}

function isWholeWordMatch(value: string, start: number, end: number): boolean {
	return !isWordCharacter(value[start - 1]) && !isWordCharacter(value[end]);
}

function isWordCharacter(value: string | undefined): boolean {
	return value !== undefined && /[A-Za-z0-9_]/.test(value);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.trunc(value)));
}

function dispatchToWebview(message: ExtensionToWebviewMessage): void {
	window.dispatchEvent(new MessageEvent('message', { data: message }));
}

/** Dev mode has no filesystem; "export to file" triggers a browser download instead. */
function downloadText(fileName: string, text: string): void {
	const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = fileName;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

export function setEmulatorRowsForSearch(nextRows: string[][]): void {
	rowsForNavigation = nextRows;
}
