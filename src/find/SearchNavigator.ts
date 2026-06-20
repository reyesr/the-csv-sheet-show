import type { CellMatcher } from '../io/CsvSearchReader';
import type { FindMatchMessage } from '../shared/messages/find';
import { clamp, isAfterCursor, isBeforeCursor } from './findCursor';
import { matchRows } from './rowMatching';
import type { FindHost, NavigationResult, SearchState } from './findTypes';

type Direction = 'next' | 'previous';

/**
 * Navigate-mode search (the highlight-and-jump "Find" experience, no filtering). Pure computation over
 * the host: it reads displayed rows and returns matches; it never posts to the webview. Scanning the
 * whole file is done in host-page-sized chunks so a huge file does not have to be read in one go.
 */
export class SearchNavigator {
	public constructor(private readonly host: FindHost) { }

	/** First match in the current viewport relative to the cursor — used for cheap in-place "update" hits. */
	public findMatchInVisibleRange(state: SearchState, matcher: CellMatcher, direction: Direction): FindMatchMessage | null {
		const start = state.visibleRange.startRowIndex;
		const rowCount = state.visibleRange.endRowIndex - start + 1;
		if (rowCount <= 0 || !this.host.canReadDisplayedRange(start, rowCount)) {
			return null;
		}

		const rows = this.host.readDisplayedRows(start, rowCount);
		const matches = matchRows(start, rows, matcher, state.options.selectedColumns);
		return direction === 'next'
			? matches.find(match => isAfterCursor(match, state.cursor)) ?? matches[0] ?? null
			: [...matches].reverse().find(match => isBeforeCursor(match, state.cursor)) ?? matches[matches.length - 1] ?? null;
	}

	/** Full-file scan from the cursor in `direction`, wrapping around once to cover every row. */
	public findNavigationMatch(state: SearchState, matcher: CellMatcher, direction: Direction): NavigationResult | null {
		const totalRows = this.host.getDisplayedReadableRowCount();
		if (totalRows <= 0) {
			return null;
		}

		const cursorRow = clamp(Math.trunc(state.cursor.rowIndex), 0, totalRows - 1);
		if (direction === 'next') {
			return this.scanForward(state, matcher, cursorRow, totalRows - 1, false)
				?? this.scanForward(state, matcher, 0, cursorRow, true);
		}

		return this.scanBackward(state, matcher, cursorRow, 0, false)
			?? this.scanBackward(state, matcher, totalRows - 1, cursorRow, true);
	}

	private scanForward(state: SearchState, matcher: CellMatcher, startRow: number, endRow: number, wrapped: boolean): NavigationResult | null {
		for (let offset = startRow; offset <= endRow;) {
			const rowCount = Math.min(this.host.pageSize, endRow - offset + 1);
			const rows = this.host.readDisplayedRows(offset, rowCount);
			const matches = matchRows(offset, rows, matcher, state.options.selectedColumns);
			const match = matches.find(candidate => wrapped || isAfterCursor(candidate, state.cursor));
			if (match !== undefined) {
				return { match, wrapped, range: { startRowIndex: offset, endRowIndex: offset + rows.length - 1 }, matches };
			}
			offset += rowCount;
		}
		return null;
	}

	private scanBackward(state: SearchState, matcher: CellMatcher, startRow: number, endRow: number, wrapped: boolean): NavigationResult | null {
		for (let chunkEnd = startRow; chunkEnd >= endRow;) {
			const offset = Math.max(endRow, chunkEnd - this.host.pageSize + 1);
			const rowCount = chunkEnd - offset + 1;
			const rows = this.host.readDisplayedRows(offset, rowCount);
			const matches = matchRows(offset, rows, matcher, state.options.selectedColumns);
			const match = [...matches].reverse().find(candidate => wrapped || isBeforeCursor(candidate, state.cursor));
			if (match !== undefined) {
				return { match, wrapped, range: { startRowIndex: offset, endRowIndex: offset + rows.length - 1 }, matches };
			}
			chunkEnd = offset - 1;
		}
		return null;
	}
}
