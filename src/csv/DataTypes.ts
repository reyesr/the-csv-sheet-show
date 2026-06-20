import { DecimalSeparator } from './CsvFileConfig';

export { DecimalSeparator } from './CsvFileConfig';

export enum CellType {
    NUMBER,
    TEXT,
    EMPTY
}

export function detectCellType(cell: string, decimalSeparator: DecimalSeparator = DecimalSeparator.BOTH): CellType {
	let start = 0;
	let end = cell.length - 1;

	while (start <= end && isWhitespace(cell.charCodeAt(start))) {
		start += 1;
	}

	while (end >= start && isWhitespace(cell.charCodeAt(end))) {
		end -= 1;
	}

	if (start > end) {
		return CellType.EMPTY;
	}

	let i = start;
	const firstCharCode = cell.charCodeAt(i);
	if (firstCharCode === 43 || firstCharCode === 45) {
		i += 1;
	}

	if (i > end) {
		return CellType.TEXT;
	}

	let hasDigit = false;
	let hasDecimalSeparator = false;

	for (; i <= end; i++) {
		const charCode = cell.charCodeAt(i);

		if (charCode >= 48 && charCode <= 57) {
			hasDigit = true;
			continue;
		}

		if (isDecimalSeparator(charCode, decimalSeparator)) {
			if (hasDecimalSeparator) {
				return CellType.TEXT;
			}

			hasDecimalSeparator = true;
			continue;
		}

		return CellType.TEXT;
	}

	return hasDigit ? CellType.NUMBER : CellType.TEXT;
}

export function detectCellTypes(cells: string[], decimalSeparator: DecimalSeparator = DecimalSeparator.BOTH): CellType[] {
	const types = new Array<CellType>(cells.length);

	for (let i = 0; i < cells.length; i++) {
		types[i] = detectCellType(cells[i], decimalSeparator);
	}

	return types;
}

function isDecimalSeparator(charCode: number, decimalSeparator: DecimalSeparator): boolean {
	if (charCode === 46) {
		return decimalSeparator === DecimalSeparator.DOT || decimalSeparator === DecimalSeparator.BOTH;
	}

	if (charCode === 44) {
		return decimalSeparator === DecimalSeparator.COMMAS || decimalSeparator === DecimalSeparator.BOTH;
	}

	return false;
}

function isWhitespace(charCode: number): boolean {
	return charCode === 32 || (charCode >= 9 && charCode <= 13);
}
