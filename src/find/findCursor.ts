import type { FindCursorLocation, FindMatchMessage } from '../shared/messages/find';

/**
 * Match/cursor ordering helpers. A cursor and a match are both located by (row, cell, char offset);
 * these compare them in document reading order so navigation can find the "next"/"previous" match
 * relative to where the user currently is.
 */

/** True when `match` is at or after `cursor` in reading order (used when scanning forward). */
export function isAfterCursor(match: FindMatchMessage, cursor: FindCursorLocation): boolean {
	return match.rowIndex > cursor.rowIndex
		|| (match.rowIndex === cursor.rowIndex && match.cellIndex > cursor.cellIndex)
		|| (match.rowIndex === cursor.rowIndex && match.cellIndex === cursor.cellIndex && match.start >= cursor.charOffset);
}

/** True when `match` is strictly before `cursor` in reading order (used when scanning backward). */
export function isBeforeCursor(match: FindMatchMessage, cursor: FindCursorLocation): boolean {
	return match.rowIndex < cursor.rowIndex
		|| (match.rowIndex === cursor.rowIndex && match.cellIndex < cursor.cellIndex)
		|| (match.rowIndex === cursor.rowIndex && match.cellIndex === cursor.cellIndex && match.start < cursor.charOffset);
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
