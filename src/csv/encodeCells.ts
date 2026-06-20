/**
 * Serializes a row of cells back into a CSV line, the inverse of {@link splitCells}.
 *
 * Per RFC 4180 a field is wrapped in double quotes when it contains the separator, a double
 * quote, or a line break (CR or LF); inner double quotes are doubled. Fields that need no
 * escaping are emitted verbatim so untouched dialects round-trip exactly.
 */
export function encodeCells(cells: string[], separator: string): string {
	return cells.map(cell => encodeCell(cell, separator)).join(separator);
}

function encodeCell(cell: string, separator: string): string {
	const needsQuoting = cell.includes('"')
		|| cell.includes('\n')
		|| cell.includes('\r')
		|| (separator.length > 0 && cell.includes(separator));

	if (!needsQuoting) {
		return cell;
	}

	return `"${cell.replace(/"/g, '""')}"`;
}
