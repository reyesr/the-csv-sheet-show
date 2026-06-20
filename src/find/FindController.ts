import type * as vscode from 'vscode';
import { type CellMatcher, createCellMatcher, type CsvSearchReader } from '../io/CsvSearchReader';
import type { FindMatchMessage, FindRequestMessage, FindVisibleRange } from '../shared/messages/find';
import { clamp } from './findCursor';
import { FilterScan } from './FilterScan';
import { matchRows } from './rowMatching';
import { SearchNavigator } from './SearchNavigator';
import type { FindHost, RowPage, SearchState } from './findTypes';

/** Cached per-page match results, plus the search signature they were computed for. */
interface PageMatches {
	key: string;
	matches: FindMatchMessage[];
}

/**
 * Owns every find/filter session (one per webview panel) and is the single authority that turns
 * webview find requests into webview replies. It dispatches between navigate mode (SearchNavigator)
 * and filter mode (FilterScan) — both pure computation — and keeps all message posting, session state
 * and the streaming filter reader's lifecycle here, behind the FindHost port.
 */
export class FindController {
	private readonly searchStates = new Map<vscode.WebviewPanel, SearchState>();
	/** Match results cached by page-object identity; entries vanish when the host replaces the page. */
	private readonly pageMatches = new WeakMap<RowPage, PageMatches>();
	private readonly navigator: SearchNavigator;
	private readonly filter: FilterScan;

	public constructor(private readonly host: FindHost) {
		this.navigator = new SearchNavigator(host);
		this.filter = new FilterScan(host);
	}

	public handleRequest(request: FindRequestMessage, panel: vscode.WebviewPanel): void {
		if (this.host.isDisposed()) {
			return;
		}

		const existingState = this.searchStates.get(panel);

		if (request.action === 'close') {
			if (existingState?.filterMode) {
				existingState.searchReader?.cancel();
				this.host.post({ type: 'findUpdateClear', searchSessionId: request.searchSessionId }, panel);
			}
			this.searchStates.delete(panel);
			this.host.post({ type: 'searchClear', searchSessionId: request.searchSessionId }, panel);
			return;
		}

		const isFilterMode = request.options.filterMode === true;

		// Leaving filter mode: tear down the streaming filter and clear its rows before falling through.
		if (existingState?.filterMode && !isFilterMode) {
			existingState.searchReader?.cancel();
			this.host.post({ type: 'findUpdateClear', searchSessionId: request.searchSessionId }, panel);
		}

		if (isFilterMode) {
			this.handleFilterMode(request, panel, existingState);
			return;
		}

		this.handleNavigateMode(request, panel);
	}

	/** Returns true (and serves the page) when `panel` is filtering, so the caller skips its normal paging. */
	public tryServeFilteredPage(requestId: string, offset: number, rowCount: number, panel: vscode.WebviewPanel): boolean {
		const state = this.searchStates.get(panel);
		if (state?.filterMode !== true) {
			return false;
		}

		const result = this.filter.computeFilteredPage(state, offset, rowCount);
		if (result.kind === 'unavailable') {
			this.host.post({
				type: 'rows-unavailable',
				requestId,
				offset: result.offset,
				rowCount: result.rowCount,
				readableRowCount: result.readableRowCount,
				isFinal: result.isFinal
			}, panel);
			return true;
		}

		this.host.post({
			type: 'rows',
			requestId,
			offset: result.offset,
			rowCount: result.rows.length,
			rows: result.rows,
			rowNumbers: result.rowNumbers,
			...(result.matches !== undefined ? { searchSessionId: result.searchSessionId, matches: result.matches } : {})
		}, panel);
		return true;
	}

	/** Match payload to attach to a page the paging path is already sending (navigate-mode highlights). */
	public getSearchPayloadForPage(panel: vscode.WebviewPanel, page: RowPage): { searchSessionId?: string; matches?: FindMatchMessage[] } {
		const state = this.searchStates.get(panel);
		if (state === undefined || state.query.length === 0) {
			return {};
		}

		try {
			const matcher = createCellMatcher(state.query, state.options);
			return { searchSessionId: state.searchSessionId, matches: this.getPageMatches(page, state, matcher) };
		} catch {
			return { searchSessionId: state.searchSessionId, matches: [] };
		}
	}

	/** Drive every active filter scan forward as the reader exposes more rows (called from stats/end). */
	public advanceFilterScans(isFinal: boolean): void {
		const readable = this.host.getDisplayedReadableRowCount();
		for (const state of this.searchStates.values()) {
			if (state.filterMode && state.searchReader !== null) {
				state.searchReader.searchAvailableRows(readable, isFinal);
			}
		}
	}

	public disposePanel(panel: vscode.WebviewPanel): void {
		this.searchStates.get(panel)?.searchReader?.cancel();
		this.searchStates.delete(panel);
	}

	public dispose(): void {
		for (const state of this.searchStates.values()) {
			state.searchReader?.cancel();
		}
		this.searchStates.clear();
	}

	// --- Filter mode ---

	private handleFilterMode(request: FindRequestMessage, panel: vscode.WebviewPanel, existingState: SearchState | undefined): void {
		// next/previous within an unchanged filter session just moves the cursor over existing matches.
		if ((request.action === 'next' || request.action === 'previous') &&
			existingState?.filterMode === true &&
			existingState.searchSessionId === request.searchSessionId) {
			existingState.cursor = request.cursor;
			existingState.visibleRange = this.normalizeVisibleRange(request.visibleRange);
			this.host.post({ type: 'searchStatus', searchSessionId: request.searchSessionId, status: 'searching' }, panel);
			const result = this.filter.findFilterNavigationMatch(existingState, request.action);
			if (result === null) {
				this.host.post({ type: 'searchStatus', searchSessionId: request.searchSessionId, status: 'noResults', message: 'No results' }, panel);
				return;
			}

			this.host.post({ type: 'searchCursor', searchSessionId: request.searchSessionId, match: result.match, wrapped: result.wrapped }, panel);
			this.host.post({
				type: 'searchStatus',
				searchSessionId: request.searchSessionId,
				status: result.wrapped ? 'wrapped' : 'ready',
				message: result.wrapped ? (request.action === 'next' ? 'Wrapped to top' : 'Wrapped to bottom') : undefined
			}, panel);
			return;
		}

		this.startFilter(request, panel);
	}

	/** Start (or restart) a streaming filter search for `panel`. */
	private startFilter(request: FindRequestMessage, panel: vscode.WebviewPanel): void {
		this.searchStates.get(panel)?.searchReader?.cancel();
		this.host.post({ type: 'findUpdateClear', searchSessionId: request.searchSessionId }, panel);

		if (request.query.length === 0) {
			this.searchStates.set(panel, this.makeState(request, true, null));
			this.host.post({ type: 'findUpdate', searchSessionId: request.searchSessionId, totalCount: 0, bytesProcessed: 0, totalBytes: 0, rows: [], isFinal: true }, panel);
			return;
		}

		let searchReader: CsvSearchReader;
		try {
			searchReader = this.filter.createReader(request);
		} catch (error) {
			this.host.post({
				type: 'searchStatus',
				searchSessionId: request.searchSessionId,
				status: 'error',
				message: error instanceof Error ? error.message : String(error)
			}, panel);
			return;
		}

		const state = this.makeState(request, true, searchReader);
		this.searchStates.set(panel, state);

		// Ignore late events from a reader that a newer search has already replaced for this panel.
		const isActive = (): boolean => !this.host.isDisposed() && this.searchStates.get(panel)?.searchReader === searchReader;

		searchReader.on('update', update => {
			if (!isActive()) {
				return;
			}
			this.host.post({
				type: 'findUpdate',
				searchSessionId: state.searchSessionId,
				totalCount: update.totalCount,
				bytesProcessed: update.bytesProcessed,
				totalBytes: update.totalBytes,
				rows: update.rows,
				isFinal: update.isFinal
			}, panel);
		});

		searchReader.on('error', error => {
			if (!isActive()) {
				return;
			}
			this.host.post({ type: 'searchStatus', searchSessionId: state.searchSessionId, status: 'error', message: error.message }, panel);
		});

		searchReader.searchAvailableRows(this.host.getDisplayedReadableRowCount(), this.host.isIndexingFinal());
	}

	// --- Navigate mode ---

	private handleNavigateMode(request: FindRequestMessage, panel: vscode.WebviewPanel): void {
		const state = this.makeState(request, false, null);

		if (state.query.length === 0) {
			this.searchStates.set(panel, state);
			this.host.post({ type: 'searchMatches', searchSessionId: state.searchSessionId, range: state.visibleRange, matches: [] }, panel);
			this.host.post({ type: 'searchStatus', searchSessionId: state.searchSessionId, status: 'ready' }, panel);
			return;
		}

		let matcher: CellMatcher;
		try {
			matcher = createCellMatcher(state.query, state.options);
		} catch (error) {
			this.searchStates.delete(panel);
			this.host.post({
				type: 'searchStatus',
				searchSessionId: state.searchSessionId,
				status: 'error',
				message: error instanceof Error ? error.message : String(error)
			}, panel);
			return;
		}

		this.searchStates.set(panel, state);
		this.postVisibleRangeMatches(panel, state, matcher);

		if (request.action === 'update') {
			const visibleMatch = this.navigator.findMatchInVisibleRange(state, matcher, 'next');
			if (visibleMatch !== null) {
				this.host.post({ type: 'searchCursor', searchSessionId: state.searchSessionId, match: visibleMatch, wrapped: false }, panel);
				this.host.post({ type: 'searchStatus', searchSessionId: state.searchSessionId, status: 'ready' }, panel);
				return;
			}

			const result = this.navigator.findNavigationMatch(state, matcher, 'next');
			if (result === null) {
				this.host.post({ type: 'searchStatus', searchSessionId: state.searchSessionId, status: 'noResults', message: 'No results' }, panel);
				return;
			}

			this.host.post({ type: 'searchMatches', searchSessionId: state.searchSessionId, range: result.range, matches: result.matches }, panel);
			this.host.post({ type: 'searchCursor', searchSessionId: state.searchSessionId, match: result.match, wrapped: result.wrapped }, panel);
			this.host.post({
				type: 'searchStatus',
				searchSessionId: state.searchSessionId,
				status: result.wrapped ? 'wrapped' : 'ready',
				message: result.wrapped ? 'Wrapped to top' : undefined
			}, panel);
			return;
		}

		if (request.action === 'next' || request.action === 'previous') {
			this.host.post({ type: 'searchStatus', searchSessionId: state.searchSessionId, status: 'searching' }, panel);
			const result = this.navigator.findNavigationMatch(state, matcher, request.action);
			if (result === null) {
				this.host.post({ type: 'searchStatus', searchSessionId: state.searchSessionId, status: 'noResults', message: 'No results' }, panel);
				return;
			}

			this.host.post({ type: 'searchMatches', searchSessionId: state.searchSessionId, range: result.range, matches: result.matches }, panel);
			this.host.post({ type: 'searchCursor', searchSessionId: state.searchSessionId, match: result.match, wrapped: result.wrapped }, panel);
			this.host.post({
				type: 'searchStatus',
				searchSessionId: state.searchSessionId,
				status: result.wrapped ? 'wrapped' : 'ready',
				message: result.wrapped ? (request.action === 'next' ? 'Wrapped to top' : 'Wrapped to bottom') : undefined
			}, panel);
			return;
		}

		this.host.post({ type: 'searchStatus', searchSessionId: state.searchSessionId, status: 'ready' }, panel);
	}

	private postVisibleRangeMatches(panel: vscode.WebviewPanel, state: SearchState, matcher: CellMatcher): void {
		const start = state.visibleRange.startRowIndex;
		const rowCount = state.visibleRange.endRowIndex - start + 1;
		if (rowCount <= 0 || !this.host.canReadDisplayedRange(start, rowCount)) {
			this.host.post({ type: 'searchMatches', searchSessionId: state.searchSessionId, range: state.visibleRange, matches: [] }, panel);
			return;
		}

		const page = this.host.getCachedPage(start, rowCount, panel);
		this.host.post({
			type: 'searchMatches',
			searchSessionId: state.searchSessionId,
			range: state.visibleRange,
			matches: this.getPageMatches(page, state, matcher)
		}, panel);
	}

	// --- Shared helpers ---

	private makeState(request: FindRequestMessage, filterMode: boolean, searchReader: CsvSearchReader | null): SearchState {
		return {
			searchSessionId: request.searchSessionId,
			query: request.query,
			options: request.options,
			cursor: request.cursor,
			visibleRange: this.normalizeVisibleRange(request.visibleRange),
			filterMode,
			searchReader
		};
	}

	private getPageMatches(page: RowPage, state: SearchState, matcher: CellMatcher): FindMatchMessage[] {
		const key = getMatchesKey(state);
		const cached = this.pageMatches.get(page);
		if (cached !== undefined && cached.key === key) {
			return cached.matches;
		}

		const matches = matchRows(page.offset, page.rows, matcher, state.options.selectedColumns);
		this.pageMatches.set(page, { key, matches });
		return matches;
	}

	private normalizeVisibleRange(range: FindVisibleRange): FindVisibleRange {
		const totalRows = this.host.getDisplayedReadableRowCount();
		if (totalRows <= 0) {
			return { startRowIndex: 0, endRowIndex: -1 };
		}

		const start = clamp(Math.trunc(range.startRowIndex), 0, totalRows - 1);
		const end = clamp(Math.trunc(range.endRowIndex), start, totalRows - 1);
		return { startRowIndex: start, endRowIndex: end };
	}
}

function getMatchesKey(state: SearchState): string {
	return `${state.searchSessionId}\0${state.query}\0${state.options.matchCase ? '1' : '0'}\0${state.options.wholeWord ? '1' : '0'}\0${state.options.regex ? '1' : '0'}\0${state.options.selectedColumns.join(',')}`;
}
