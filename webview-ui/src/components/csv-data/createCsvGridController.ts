import { createMemo, createSignal } from 'solid-js';
import type { CsvLoadErrorReason } from '../../../../src/shared/messages/errors';
import type { FindCursorLocation, FindMatchMessage, FindUpdateMessage, FindVisibleRange } from '../../../../src/shared/messages/find';
import type { HeadersMessage, PageMessage, RowsMessage, RowsUnavailableMessage, StatisticsMessage } from '../../../../src/shared/messages/gridData';
import { BLOCK_SIZE, PREFETCH_BLOCKS } from '../../constants';
import type { CsvGridController, RowRequestReason } from '../../types';
import { postMessage } from '../../vscode';
import { log } from '../messaging/log';
import { getDataRowCount } from '../table/tableUtils';

export function createCsvGridController(): CsvGridController {
	const [lastEvent, setLastEvent] = createSignal('initializing');
	const [offset, setOffset] = createSignal(0);
	const [rowCount, setRowCount] = createSignal(BLOCK_SIZE);
	const [stats, setStats] = createSignal<StatisticsMessage | null>(null);
	const [maxColumnCount, setMaxColumnCount] = createSignal(1);
	const [headerCells, setHeaderCells] = createSignal<string[]>([]);
	// True when a header row was added to a header-less file (cells keep empty strings for unnamed columns).
	const [headerInserted, setHeaderInserted] = createSignal(false);
	const [visibleRange, setVisibleRange] = createSignal<FindVisibleRange>({ startRowIndex: 0, endRowIndex: -1 });
	const [cursorLocation, setCursorLocation] = createSignal<FindCursorLocation>({ rowIndex: 0, cellIndex: 0, charOffset: 0 });
	const [message, setMessage] = createSignal('Waiting for first page...');
	const [loadErrorReason, setLoadErrorReason] = createSignal<CsvLoadErrorReason | null>(null);
	const [cacheVersion, setCacheVersion] = createSignal(0);
	const rowCache = new Map<number, string[]>();
	const inFlightBlocks = new Set<number>();
	const unavailableBlocks = new Set<number>();
	const filteredRowCache: Array<{ offset: number; matches: FindMatchMessage[] }> = [];
	const filterRowNumbers = new Map<number, number>();
	const [filterModeRowCount, setFilterModeRowCount] = createSignal<number | null>(null);
	let requestSequence = 0;
	let scrollToVirtualRow: ((rowIndex: number, align: 'start' | 'center') => void) | null = null;
	let scrollToCell: ((rowIndex: number, columnIndex: number, align: 'start' | 'center') => void) | null = null;
	let focusGrid: (() => void) | null = null;
	let gridNavigationKeyHandler: ((event: KeyboardEvent) => void) | null = null;

	log('info', 'Webview mounted, initializing');

	const hasCsvHeader = createMemo(() => stats()?.config.hasHeader === true);
	// A header exists (and is editable) when the file has a real header OR one was added to it.
	const headerExists = createMemo(() => hasCsvHeader() || headerInserted());
	const isFinal = createMemo(() => stats()?.isFinal === true);
	const sourceAvailableRowCount = createMemo(() => {
		const currentStats = stats();
		if (currentStats === null) {
			return 0;
		}

		return currentStats.isFinal ? currentStats.rowCount : currentStats.readableRowCount;
	});
	const virtualRowCount = createMemo(() => {
		const filterCount = filterModeRowCount();
		if (filterCount !== null) {
			return filterCount;
		}
		return Math.max(0, sourceAvailableRowCount());
	});
	const cachedRowCount = createMemo(() => {
		cacheVersion();
		return rowCache.size;
	});
	// Quiet right-zone count (§08): "55,620 rows · 7 cols", monospace with thousands separators,
	// plus a discreet loading suffix until the file is fully read.
	const statsText = createMemo(() => {
		const currentStats = stats();
		if (currentStats === null) {
			return 'Loading CSV…';
		}

		const rows = currentStats.rowCount;
		const cols = maxColumnCount();
		const summary = `${rows.toLocaleString('en-US')} ${rows === 1 ? 'row' : 'rows'} · ${cols.toLocaleString('en-US')} ${cols === 1 ? 'col' : 'cols'}`;
		if (currentStats.isFinal) {
			return summary;
		}

		const loadingRatio = Math.round((currentStats.totalSizeInBytes > 0 ? currentStats.totalBytesRead / currentStats.totalSizeInBytes : 0) * 100);
		return `${summary} · loading ${loadingRatio}%`;
	});
	function loadPage(): void {
		log('info', 'Scrolling to row', {
			offset: offset(),
			rowCount: rowCount()
		});
		scrollToVirtualRow?.(offset(), 'start');
		requestBlocksAroundRange(offset(), offset() + rowCount(), 'viewport');
	}

	function mergeRows(rowOffset: number, rows: string[][]): void {
		let nextMaxColumnCount = maxColumnCount();
		for (let index = 0; index < rows.length; index++) {
			const row = rows[index];
			rowCache.set(rowOffset + index, row);
			nextMaxColumnCount = Math.max(nextMaxColumnCount, row.length);
		}
		setMaxColumnCount(nextMaxColumnCount);
		setCacheVersion(version => version + 1);
	}

	function requestBlocksAroundRange(startIndex: number, endIndex: number, reason: 'viewport' | 'prefetch'): void {
		const startBlock = blockStartForRow(startIndex);
		const endBlock = blockStartForRow(endIndex);

		for (let blockStart = startBlock - BLOCK_SIZE * PREFETCH_BLOCKS; blockStart <= endBlock + BLOCK_SIZE * PREFETCH_BLOCKS; blockStart += BLOCK_SIZE) {
			requestBlock(blockStart, blockStart >= startBlock && blockStart <= endBlock ? reason : 'prefetch');
		}
	}

	function refreshRows(startIndex: number, endIndex: number): void {
		const startBlock = blockStartForRow(startIndex);
		const endBlock = blockStartForRow(endIndex);
		const totalRows = sourceAvailableRowCount();

		for (let blockStart = startBlock; blockStart <= endBlock; blockStart += BLOCK_SIZE) {
			const requestRowCount = totalRows === 0 ? BLOCK_SIZE : Math.min(BLOCK_SIZE, Math.max(0, totalRows - blockStart));
			if (requestRowCount <= 0) {
				continue;
			}

			const requestId = `find-refresh:${blockStart}:${requestSequence++}`;
			postMessage({
				type: 'requestRows',
				requestId,
				offset: blockStart,
				rowCount: requestRowCount,
				reason: 'viewport'
			});
		}
	}

	function requestBlock(blockStart: number, reason: RowRequestReason): void {
		if (blockStart < 0 || inFlightBlocks.has(blockStart) || isBlockLoaded(blockStart) || unavailableBlocks.has(blockStart)) {
			return;
		}

		const totalRows = sourceAvailableRowCount();
		if (totalRows > 0 && blockStart >= totalRows) {
			return;
		}

		const requestRowCount = totalRows === 0 ? BLOCK_SIZE : Math.min(BLOCK_SIZE, totalRows - blockStart);
		if (requestRowCount <= 0) {
			return;
		}

		const requestId = `${blockStart}:${requestSequence++}`;
		inFlightBlocks.add(blockStart);
		postMessage({
			type: 'requestRows',
			requestId,
			offset: blockStart,
			rowCount: requestRowCount,
			reason
		});
	}

	function isBlockLoaded(blockStart: number): boolean {
		const totalRows = sourceAvailableRowCount();
		const blockEnd = totalRows === 0 ? blockStart + BLOCK_SIZE : Math.min(blockStart + BLOCK_SIZE, totalRows);
		for (let rowIndex = blockStart; rowIndex < blockEnd; rowIndex++) {
			if (!rowCache.has(rowIndex)) {
				return false;
			}
		}

		return blockEnd > blockStart;
	}

	function markBlockFinished(offset: number, unavailable: boolean): void {
		const blockStart = blockStartForRow(offset);
		inFlightBlocks.delete(blockStart);

		if (unavailable) {
			unavailableBlocks.add(blockStart);
			return;
		}

		unavailableBlocks.delete(blockStart);
	}

	function clearRetryableUnavailableBlocks(readableRowCount: number): void {
		for (const blockStart of unavailableBlocks) {
			if (blockStart < readableRowCount) {
				unavailableBlocks.delete(blockStart);
			}
		}
	}

	function blockStartForRow(rowIndex: number): number {
		return Math.max(0, Math.floor(rowIndex / BLOCK_SIZE) * BLOCK_SIZE);
	}

	function getCachedRow(rowIndex: number): string[] | null {
		cacheVersion();
		return rowCache.get(rowIndex) ?? null;
	}

	function getCellValue(rowIndex: number, columnIndex: number): string {
		return getCachedRow(rowIndex)?.[columnIndex] ?? '';
	}

	function getHeaderValue(columnIndex: number): string {
		return headerCells()[columnIndex] ?? '';
	}

	/** Optimistically show a freshly-added (empty) header row of `columnCount` cells on a header-less file. */
	function applyLocalAddHeader(columnCount: number): void {
		setHeaderCells(Array.from({ length: Math.max(1, columnCount) }, () => ''));
		setHeaderInserted(true);
		setMaxColumnCount(count => Math.max(count, columnCount));
	}

	/** Revert an optimistically-added header (the user cancelled before naming anything, or the add was rejected). */
	function clearLocalHeader(): void {
		setHeaderInserted(false);
		setHeaderCells([]);
	}

	/** Optimistically write a header cell, returning the previous value for rollback. */
	function applyLocalHeaderEdit(columnIndex: number, value: string): string {
		const current = headerCells();
		const previous = current[columnIndex] ?? '';
		const next = current.slice();
		while (next.length <= columnIndex) {
			next.push('');
		}
		next[columnIndex] = value;
		setHeaderCells(next);
		setMaxColumnCount(count => Math.max(count, next.length));
		return previous;
	}

	/** Optimistically write a cell into the local cache, returning the previous value for rollback. */
	function applyLocalCellEdit(rowIndex: number, columnIndex: number, value: string): string {
		const existing = rowCache.get(rowIndex);
		const row = existing !== undefined ? existing.slice() : [];
		const previous = row[columnIndex] ?? '';
		while (row.length <= columnIndex) {
			row.push('');
		}
		row[columnIndex] = value;
		rowCache.set(rowIndex, row);
		setMaxColumnCount(current => Math.max(current, row.length));
		setCacheVersion(version => version + 1);
		return previous;
	}

	/** Drop cached rows in a (possibly open-ended) virtual range and re-request the viewport. */
	function invalidateRows(startRowIndex: number, endRowIndex: number | null): void {
		for (const key of [...rowCache.keys()]) {
			if (key >= startRowIndex && (endRowIndex === null || key <= endRowIndex)) {
				rowCache.delete(key);
			}
		}
		inFlightBlocks.clear();
		unavailableBlocks.clear();
		if (startRowIndex === 0 && endRowIndex === null) {
			setMaxColumnCount(1);
		}
		setCacheVersion(version => version + 1);
		const range = visibleRange();
		requestBlocksAroundRange(range.startRowIndex, range.endRowIndex, 'viewport');
	}

	function sourceRowForVirtualRow(rowIndex: number): number {
		return rowIndex;
	}

	function getRowDisplayNumber(virtualRowIndex: number): number {
		if (filterModeRowCount() !== null) {
			const cached = filteredRowCache[virtualRowIndex];
			if (cached !== undefined) {
				return cached.offset + 1;
			}
			const fromRequest = filterRowNumbers.get(virtualRowIndex);
			if (fromRequest !== undefined) {
				return fromRequest + 1;
			}
		}
		return virtualRowIndex + 1;
	}

	function applyFilterUpdate(message: FindUpdateMessage): void {
		let nextMax = maxColumnCount();
		for (let i = 0; i < message.rows.length; i++) {
			const row = message.rows[i];
			const gridIndex = filteredRowCache.length;
			filteredRowCache.push({ offset: row.offset, matches: row.matches });
			rowCache.set(gridIndex, row.cells);
			if (row.cells.length > nextMax) {
				nextMax = row.cells.length;
			}
		}
		setMaxColumnCount(nextMax);
		clearRetryableUnavailableBlocks(message.totalCount);
		setCacheVersion(version => version + 1);
		setFilterModeRowCount(message.totalCount);
	}

	function clearFilterCache(): void {
		filteredRowCache.length = 0;
		filterRowNumbers.clear();
		rowCache.clear();
		inFlightBlocks.clear();
		unavailableBlocks.clear();
		setMaxColumnCount(1);
		setFilterModeRowCount(null);
		setCacheVersion(version => version + 1);
	}

	function handleStatistics(statistics: StatisticsMessage): void {
		setLoadErrorReason(null);
		setStats(statistics);
		// Clear stale header cells when the file has no real header — but keep a header that was added to it.
		if (!statistics.config.hasHeader && !headerInserted()) {
			setHeaderCells([]);
		}
		clearRetryableUnavailableBlocks(statistics.readableRowCount);
		if (statistics.isFinal && getDataRowCount(statistics) === 0) {
			setMessage(statistics.config.hasHeader ? 'No data rows' : 'No rows');
		}
	}

	function handleHeaders(headersMessage: HeadersMessage): void {
		log('info', 'Received headers', {
			cellCount: headersMessage.cells.length,
			cells: headersMessage.cells
		});
		setHeaderInserted(headersMessage.headerInserted === true);
		setHeaderCells(headersMessage.cells);
		setMaxColumnCount(Math.max(headersMessage.cells.length, 1));
	}

	function handlePage(page: PageMessage): void {
		log('info', 'Received page', {
			offset: page.offset,
			rowCount: page.rowCount,
			rowsLength: Array.isArray(page.rows) ? page.rows.length : null,
			firstRowCellCount: Array.isArray(page.rows?.[0]) ? page.rows[0].length : null
		});
		setLoadErrorReason(null);
		mergeRows(page.offset, page.rows);
		setMessage(page.rows.length === 0 ? 'No rows' : '');
	}

	function handleRows(rowsMessage: RowsMessage): void {
		log('info', 'Received rows', {
			requestId: rowsMessage.requestId,
			offset: rowsMessage.offset,
			rowCount: rowsMessage.rowCount,
			rowsLength: Array.isArray(rowsMessage.rows) ? rowsMessage.rows.length : null,
			firstRowCellCount: Array.isArray(rowsMessage.rows?.[0]) ? rowsMessage.rows[0].length : null,
		});
		setLoadErrorReason(null);
		if (rowsMessage.rowNumbers !== undefined) {
			for (let i = 0; i < rowsMessage.rowNumbers.length; i++) {
				filterRowNumbers.set(rowsMessage.offset + i, rowsMessage.rowNumbers[i]);
			}
		}
		markBlockFinished(rowsMessage.offset, false);
		mergeRows(rowsMessage.offset, rowsMessage.rows);
		setMessage(rowsMessage.rows.length === 0 ? 'No rows' : '');
	}

	function handleRowsUnavailable(unavailable: RowsUnavailableMessage): void {
		log('info', 'Rows unavailable', {
			requestId: unavailable.requestId,
			offset: unavailable.offset,
			rowCount: unavailable.rowCount,
			readableRowCount: unavailable.readableRowCount,
			isFinal: unavailable.isFinal
		});
		markBlockFinished(unavailable.offset, true);
	}

	function handleError(reason: CsvLoadErrorReason): void {
		log('error', 'Received load error', { reason });
		rowCache.clear();
		inFlightBlocks.clear();
		unavailableBlocks.clear();
		setHeaderCells([]);
		setHeaderInserted(false);
		setMaxColumnCount(1);
		setCacheVersion(version => version + 1);
		setMessage('Could not load CSV');
		setLoadErrorReason(reason);
	}

	function scrollToSourceRow(rowIndex: number, align: 'start' | 'center' = 'center'): void {
		scrollToVirtualRow?.(rowIndex, align);
		requestBlocksAroundRange(rowIndex, rowIndex, 'viewport');
	}

	function scrollToSourceCell(rowIndex: number, columnIndex: number, align: 'start' | 'center' = 'center'): void {
		scrollToCell?.(rowIndex, columnIndex, align);
		requestBlocksAroundRange(rowIndex, rowIndex, 'viewport');
	}

	const csvConfig = createMemo(() => stats()?.config ?? null);

	return {
		csvConfig,
		statsText,
		lastEvent,
		offset,
		rowCount,
		setOffset,
		setRowCount,
		maxColumnCount,
		message,
		loadErrorReason,
		hasCsvHeader,
		headerExists,
		headerInserted,
		isFinal,
		headerCells,
		visibleRange,
		cursorLocation,
		virtualRowCount,
		cachedRowCount,
		getSourceRowIndex: sourceRowForVirtualRow,
		getRowDisplayNumber,
		getCachedRow,
		getCellValue,
		getHeaderValue,
		applyLocalCellEdit,
		applyLocalAddHeader,
		clearLocalHeader,
		applyLocalHeaderEdit,
		invalidateRows,
		loadPage,
		requestVirtualRows: requestBlocksAroundRange,
		refreshRows,
		setScrollToVirtualRow: handler => { scrollToVirtualRow = handler; },
		setScrollToCell: handler => { scrollToCell = handler; },
		setFocusGrid: handler => { focusGrid = handler; },
		focusGrid: () => focusGrid?.(),
		setGridNavigationKeyHandler: handler => { gridNavigationKeyHandler = handler; },
		handleGridNavigationKey: event => gridNavigationKeyHandler?.(event),
		setVisibleRange,
		setCursorLocation,
		setLastEvent,
		markInitialBlockInFlight: () => inFlightBlocks.add(0),
		handleStatistics,
		handleHeaders,
		handlePage,
		handleRows,
		handleRowsUnavailable,
		handleError,
		scrollToSourceRow,
		scrollToSourceCell,
		applyFilterUpdate,
		clearFilterCache
	};
}
