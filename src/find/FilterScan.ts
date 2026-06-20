import { createCellMatcher, CsvSearchReader } from '../io/CsvSearchReader';
import type { FindMatchMessage, FindRequestMessage } from '../shared/messages/find';
import { clamp, isAfterCursor, isBeforeCursor } from './findCursor';
import { groupConsecutiveOffsets, matchCellsInRow, toColumnSet } from './rowMatching';
import type { FilteredPageResult, FindHost, NavigationResult, SearchState } from './findTypes';

/** Fallback when the webview does not send initialRowsExpected (kept generous so the first screen always streams). */
const DEFAULT_FILTER_INITIAL_ROWS = 200;

type Direction = 'next' | 'previous';

/**
 * Filter-mode search (rows that don't match are hidden). The streaming scan itself lives in
 * CsvSearchReader; this class is the pure, host-backed glue around it: it builds a reader, serves
 * filtered pages on top of the reader's matchingRows offsets, and navigates between matches. Like
 * SearchNavigator it computes and returns — the controller owns the reader lifecycle and posting.
 */
export class FilterScan {
	public constructor(private readonly host: FindHost) { }

	/** Build a streaming filter reader for `request`; throws synchronously on an invalid regex. */
	public createReader(request: FindRequestMessage): CsvSearchReader {
		return new CsvSearchReader(this.host.reader, request.query, request.options, {
			initialRowsExpected: request.initialRowsExpected ?? DEFAULT_FILTER_INITIAL_ROWS,
			startFromRow: 0,
			selectedColumns: request.options.selectedColumns,
			readRows: (offset, count) => this.host.readVirtualRows(offset, count)
		});
	}

	/** Resolve the filtered grid rows for `[gridOffset, gridOffset + rowCount)` from the reader's matches. */
	public computeFilteredPage(state: SearchState, gridOffset: number, rowCount: number): FilteredPageResult {
		const matchingRows = state.searchReader?.getMatchingRows() ?? [];
		const available = Math.min(gridOffset + rowCount, matchingRows.length) - gridOffset;
		if (available <= 0) {
			const isFilterDone = state.searchReader === null || state.searchReader.isComplete();
			return { kind: 'unavailable', offset: gridOffset, rowCount, readableRowCount: matchingRows.length, isFinal: isFilterDone };
		}

		if (this.host.getConfig() === null) {
			return { kind: 'unavailable', offset: gridOffset, rowCount: available, readableRowCount: 0, isFinal: false };
		}

		const originalOffsets = matchingRows.slice(gridOffset, gridOffset + available);
		const resultRows: string[][] = [];
		for (const run of groupConsecutiveOffsets(originalOffsets)) {
			for (const row of this.host.readVirtualRows(run.start, run.length)) {
				resultRows.push(row);
			}
		}

		if (state.query.length === 0) {
			return { kind: 'rows', offset: gridOffset, rows: resultRows, rowNumbers: originalOffsets };
		}

		const matcher = createCellMatcher(state.query, state.options);
		const columns = toColumnSet(state.options.selectedColumns);
		const matches: FindMatchMessage[] = [];
		for (let i = 0; i < resultRows.length; i++) {
			matches.push(...matchCellsInRow(gridOffset + i, resultRows[i], matcher, columns));
		}
		return { kind: 'rows', offset: gridOffset, rows: resultRows, rowNumbers: originalOffsets, searchSessionId: state.searchSessionId, matches };
	}

	/** Jump to the next/previous match within the filtered grid, wrapping around the cursor row once. */
	public findFilterNavigationMatch(state: SearchState, direction: Direction): NavigationResult | null {
		const matchingRows = state.searchReader?.getMatchingRows() ?? [];
		if (matchingRows.length === 0 || this.host.getConfig() === null) {
			return null;
		}

		const gridCount = matchingRows.length;
		const cursorGridRow = clamp(Math.trunc(state.cursor.rowIndex), 0, gridCount - 1);
		const columns = toColumnSet(state.options.selectedColumns);
		const matcher = createCellMatcher(state.query, state.options);

		const tryRow = (gridIndex: number, wrapped: boolean): NavigationResult | null => {
			const rows = this.host.readVirtualRows(matchingRows[gridIndex], 1);
			if (rows.length === 0) {
				return null;
			}

			const rowMatches = matchCellsInRow(gridIndex, rows[0], matcher, columns);
			const match = direction === 'next'
				? rowMatches.find(m => wrapped || isAfterCursor(m, state.cursor)) ?? (wrapped ? rowMatches[0] ?? null : null)
				: [...rowMatches].reverse().find(m => wrapped || isBeforeCursor(m, state.cursor)) ?? (wrapped ? rowMatches[rowMatches.length - 1] ?? null : null);
			if (match === null) {
				return null;
			}
			return { match, wrapped, range: { startRowIndex: gridIndex, endRowIndex: gridIndex }, matches: rowMatches };
		};

		if (direction === 'next') {
			for (let i = cursorGridRow; i < gridCount; i++) {
				const result = tryRow(i, false);
				if (result !== null) {
					return result;
				}
			}
			for (let i = 0; i < cursorGridRow; i++) {
				const result = tryRow(i, true);
				if (result !== null) {
					return result;
				}
			}
		} else {
			for (let i = cursorGridRow; i >= 0; i--) {
				const result = tryRow(i, false);
				if (result !== null) {
					return result;
				}
			}
			for (let i = gridCount - 1; i > cursorGridRow; i--) {
				const result = tryRow(i, true);
				if (result !== null) {
					return result;
				}
			}
		}

		return null;
	}
}
