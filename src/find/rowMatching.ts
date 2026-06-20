import type { CellMatcher } from '../io/CsvSearchReader';
import type { FindMatchMessage } from '../shared/messages/find';

/**
 * Pure row-matching primitives shared by navigate mode, filter paging and filter navigation. Keeping
 * the per-cell scan in one place avoids the three near-identical nested loops the logic grew before.
 */

/** Build the column filter once: `null` means "every column", otherwise restrict to this set. */
export function toColumnSet(selectedColumns: number[]): Set<number> | null {
	return selectedColumns.length > 0 ? new Set(selectedColumns) : null;
}

/**
 * Find every match in a single row's cells. `rowIndex` is the value stamped onto each emitted match —
 * callers pass the absolute displayed row (navigate mode) or the filtered-grid index (filter mode).
 */
export function matchCellsInRow(rowIndex: number, cells: string[], matcher: CellMatcher, columns: Set<number> | null): FindMatchMessage[] {
	const matches: FindMatchMessage[] = [];
	for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
		if (columns !== null && !columns.has(cellIndex)) {
			continue;
		}

		for (const range of matcher.findMatches(cells[cellIndex])) {
			matches.push({ rowIndex, cellIndex, start: range.start, end: range.end });
		}
	}
	return matches;
}

/** Find every match across a contiguous block of `rows` that starts at displayed row `rowOffset`. */
export function matchRows(rowOffset: number, rows: string[][], matcher: CellMatcher, selectedColumns: number[]): FindMatchMessage[] {
	const columns = toColumnSet(selectedColumns);
	const matches: FindMatchMessage[] = [];
	for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
		matches.push(...matchCellsInRow(rowOffset + rowIndex, rows[rowIndex], matcher, columns));
	}
	return matches;
}

export interface OffsetRun {
	start: number;
	length: number;
}

/** Collapse a list of (ascending) row offsets into consecutive runs so they can be read in batches. */
export function groupConsecutiveOffsets(offsets: readonly number[]): OffsetRun[] {
	const runs: OffsetRun[] = [];
	if (offsets.length === 0) {
		return runs;
	}

	let runStart = offsets[0];
	let runLength = 1;

	for (let i = 1; i < offsets.length; i++) {
		if (offsets[i] === offsets[i - 1] + 1) {
			runLength++;
		} else {
			runs.push({ start: runStart, length: runLength });
			runStart = offsets[i];
			runLength = 1;
		}
	}
	runs.push({ start: runStart, length: runLength });
	return runs;
}
