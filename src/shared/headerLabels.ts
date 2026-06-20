/**
 * Default labels for unnamed columns. Shared by the webview (display), the writer (save) and the
 * export pipeline so all three agree on how an empty header cell is materialized.
 *
 * A header-less file (or a freshly-added header whose cells are still empty) stores empty strings;
 * those empties are rendered/serialized as `column_1 … column_N` (1-based) rather than as blank
 * fields. A real, file-backed header is never materialized — its empty cells are genuine content.
 */
export function defaultHeaderLabel(columnIndex: number): string {
	return `column_${columnIndex + 1}`;
}

/** A single header cell's display/serialized name: its value, or `column_N` when empty/missing. */
export function materializeHeaderCell(value: string | undefined, columnIndex: number): string {
	return value === undefined || value === '' ? defaultHeaderLabel(columnIndex) : value;
}

/** Materialize a full header row to `columnCount` names, replacing empty/missing cells with `column_N`. */
export function materializeHeaderNames(cells: readonly string[], columnCount: number): string[] {
	return Array.from({ length: columnCount }, (_, columnIndex) => materializeHeaderCell(cells[columnIndex], columnIndex));
}
