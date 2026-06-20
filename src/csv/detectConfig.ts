import * as chardet from 'chardet';
import * as iconv from 'iconv-lite';
import { detectBufferEncoding } from '../io/EncodingUtils';
import { LineEndingDetector } from '../io/LineEndingDetector';
import { CellType, detectCellType } from './DataTypes';
import { CsvFileConfig, DecimalSeparator } from './CsvFileConfig';
import { CsvTokenizedPartType, CsvTokenizer } from './CsvTokenizer';
import { detectCellSeparator } from './detectCellSeparator';
import { splitCells } from './splitCells';

export function detectConfig(buffer: Buffer, config?: Partial<CsvFileConfig>): CsvFileConfig {
	const encoding = config?.encoding ?? detectEncoding(buffer);
	const content = decodeBufferWithEncoding(buffer, encoding);
	const lineEnding = config?.lineEnding === undefined
		? lineEndingNameToValue(detectLineEndingOutsideQuotes(content))
		: normalizeLineEnding(config.lineEnding);
	const separator = config?.separator ?? detectCellSeparator(content, lineEnding);
	const rows = splitRows(content, lineEnding);
	const decimalSeparator = config?.decimalSeparator ?? detectDecimalSeparator(rows, separator);
	const hasHeader = config?.hasHeader ?? detectHeader(rows, separator, decimalSeparator);

	return {
		separator,
		encoding,
		lineEnding,
		decimalSeparator,
		hasHeader
	};
}

function detectEncoding(buffer: Buffer): string {
	if (isAscii(buffer)) { // treat ascii as utf-8 for convenience
		return 'utf-8';
	}
	const detected = chardet.detect(buffer) as string | null;
	if (detected?.toLowerCase() === 'utf8') {
		return 'utf-8';
	}
	if (detected?.toLowerCase() === 'ascii') {
		return 'utf-8';
	}

	return detectBufferEncoding(detected ?? undefined) ?? detected ?? 'utf8';
}

export function isAscii(buffer: Buffer): boolean {
	for (const byte of buffer) {
		if (byte > 127) {
			return false;
		}
	}
	return true;
}

function decodeBufferWithEncoding(buffer: Buffer, encoding: string): string {
	try {
		return iconv.decode(buffer, encoding);
	} catch {
		return buffer.toString('utf8');
	}
}

function detectLineEndingOutsideQuotes(content: string): string {
	const detector = new LineEndingDetector();
	const tokenizer = new CsvTokenizer(content);

	while (true) {
		const part = tokenizer.parse();
		if (part.type === CsvTokenizedPartType.END_OF_CONTENT) {
			return detector.getMostLikelyLineEndings();
		}

		if (part.type === CsvTokenizedPartType.UNQUOTED) {
			detector.addContent(content.slice(part.start, part.end));
		}
	}
}

// Char codes for the two candidate decimal separators.
const DOT_CODE = 46;
const COMMA_CODE = 44;

interface DecimalVote {
	char: number; // DOT_CODE or COMMA_CODE
	tier: number; // 1 = decisive, 2 = strong, 3 = moderate (see classifyDecimalCell)
}

function detectDecimalSeparator(rows: string[], separator: string): DecimalSeparator {
	// Tally votes per evidence tier so that stronger evidence can override weaker.
	const dotVotes = [0, 0, 0, 0];
	const commaVotes = [0, 0, 0, 0];

	for (const row of rows) {
		const cells = splitCells(row, separator);

		for (const cell of cells) {
			const vote = classifyDecimalCell(cell);
			if (vote === null) {
				continue;
			}

			const votes = vote.char === DOT_CODE ? dotVotes : commaVotes;
			votes[vote.tier] += 1;
		}
	}

	// Resolve on the strongest tier that has a clear winner; defer ties to weaker tiers.
	for (let tier = 1; tier <= 3; tier++) {
		if (dotVotes[tier] === commaVotes[tier]) {
			continue;
		}

		return dotVotes[tier] > commaVotes[tier] ? DecimalSeparator.DOT : DecimalSeparator.COMMAS;
	}

	return DecimalSeparator.BOTH;
}

/**
 * Classifies a single cell as evidence for the dot or comma being the decimal
 * separator, or returns null when the cell carries no usable signal.
 *
 * Tiers, from strongest to weakest:
 *   1 (decisive): the cell contains both `.` and `,`; the rightmost one is the
 *                 decimal separator and the other is digit grouping
 *                 (e.g. `1,234.56` -> dot, `1.234,56` -> comma).
 *   2 (strong):   the cell contains a single separator type repeated as valid
 *                 digit grouping (e.g. `1.234.567`); that char is grouping, so
 *                 the OTHER char must be the decimal separator.
 *   3 (moderate): the cell contains a single separator that is not followed by
 *                 exactly three digits (e.g. `1,5`); grouping always comes in
 *                 groups of three, so that separator must be the decimal point.
 *
 * A single separator followed by exactly three digits (e.g. `1,234`) is
 * genuinely ambiguous between grouping and a decimal, so it yields no vote.
 */
function classifyDecimalCell(cell: string): DecimalVote | null {
	let start = 0;
	let end = cell.length - 1;

	while (start <= end && isWhitespace(cell.charCodeAt(start))) {
		start += 1;
	}

	while (end >= start && isWhitespace(cell.charCodeAt(end))) {
		end -= 1;
	}

	if (start > end) {
		return null;
	}

	let i = start;
	const firstCharCode = cell.charCodeAt(i);
	if (firstCharCode === 43 || firstCharCode === 45) {
		i += 1;
	}

	let dotCount = 0;
	let commaCount = 0;
	let lastDot = -1;
	let lastComma = -1;
	let hasDigit = false;
	let sawSeparator = false;
	let firstGroup = 0;             // digits before the first separator
	let currentGroup = 0;           // digits since the last separator
	let interiorGroupsValid = true; // every completed group after the first is exactly three digits

	for (; i <= end; i++) {
		const charCode = cell.charCodeAt(i);

		if (charCode >= 48 && charCode <= 57) {
			hasDigit = true;
			currentGroup += 1;
			continue;
		}

		if (charCode === DOT_CODE || charCode === COMMA_CODE) {
			if (!sawSeparator) {
				firstGroup = currentGroup;
			} else if (currentGroup !== 3) {
				interiorGroupsValid = false;
			}
			sawSeparator = true;

			if (charCode === DOT_CODE) {
				dotCount += 1;
				lastDot = i;
			} else {
				commaCount += 1;
				lastComma = i;
			}

			currentGroup = 0;
			continue;
		}

		return null; // any other character means this is not a numeric cell
	}

	if (!hasDigit) {
		return null;
	}

	const digitsAfterLast = currentGroup;

	// Tier 1: both separators present — the rightmost one is the decimal point.
	if (dotCount > 0 && commaCount > 0) {
		return { char: lastDot > lastComma ? DOT_CODE : COMMA_CODE, tier: 1 };
	}

	// Tier 2: a single separator type repeated as valid grouping — the other char is decimal.
	if (dotCount > 1 || commaCount > 1) {
		const validGrouping = firstGroup >= 1 && firstGroup <= 3
			&& interiorGroupsValid && digitsAfterLast === 3;
		if (!validGrouping) {
			return null;
		}

		return { char: dotCount > 1 ? COMMA_CODE : DOT_CODE, tier: 2 };
	}

	// Tier 3: a single separator that cannot be grouping (not exactly three trailing digits).
	if (dotCount === 1 || commaCount === 1) {
		if (digitsAfterLast === 0 || digitsAfterLast === 3) {
			return null; // `1,234` is ambiguous; a trailing separator carries no signal
		}

		return { char: dotCount === 1 ? DOT_CODE : COMMA_CODE, tier: 3 };
	}

	return null; // no separator at all (a plain integer) — no decimal signal
}

function detectHeader(rows: string[], separator: string, decimalSeparator: DecimalSeparator): boolean {
	if (rows.length < 2) {
		return false;
	}

	const firstLineCells = splitCells(rows[0], separator);
	if (firstLineCells.length === 0) {
		return false;
	}

	if (isTextHeader(firstLineCells, decimalSeparator) && remainingRowsContainNumberOrEmpty(rows, separator, decimalSeparator)) {
		return true;
	}

	return isUppercaseHeader(firstLineCells) && remainingRowsContainLowercase(rows, separator);
}

function isTextHeader(cells: string[], decimalSeparator: DecimalSeparator): boolean {
	for (const cell of cells) {
		if (detectCellType(cell, decimalSeparator) !== CellType.TEXT) {
			return false;
		}
	}

	return true;
}

function remainingRowsContainNumberOrEmpty(rows: string[], separator: string, decimalSeparator: DecimalSeparator): boolean {
	for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
		const cells = splitCells(rows[rowIndex], separator);

		for (const cell of cells) {
			const type = detectCellType(cell, decimalSeparator);
			if (type === CellType.NUMBER || type === CellType.EMPTY) {
				return true;
			}
		}
	}

	return false;
}

function isUppercaseHeader(cells: string[]): boolean {
	for (const cell of cells) {
		if (!containsUppercaseAndNoLowercase(cell)) {
			return false;
		}
	}

	return true;
}

function remainingRowsContainLowercase(rows: string[], separator: string): boolean {
	for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
		const cells = splitCells(rows[rowIndex], separator);

		for (const cell of cells) {
			if (containsLowercase(cell)) {
				return true;
			}
		}
	}

	return false;
}

function splitRows(content: string, lineEnding: string): string[] {
	if (lineEnding.length === 0) {
		return [content];
	}

	const rows: string[] = [];
	const tokenizer = new CsvTokenizer(content);
	let rowStart = 0;

	while (true) {
		const part = tokenizer.parse();
		if (part.type === CsvTokenizedPartType.END_OF_CONTENT) {
			rows.push(content.slice(rowStart));
			return rows;
		}

		if (part.type !== CsvTokenizedPartType.UNQUOTED) {
			continue;
		}

		for (let i = part.start; i < part.end; i++) {
			if (!content.startsWith(lineEnding, i)) {
				continue;
			}

			rows.push(content.slice(rowStart, i));
			i += lineEnding.length - 1;
			rowStart = i + 1;
		}
	}
}

function normalizeLineEnding(lineEnding: string): string {
	switch (lineEnding) {
		case 'CRLF':
			return '\r\n';
		case 'CR':
			return '\r';
		case 'LF':
			return '\n';
		case '':
			return '\n';
		default:
			return lineEnding;
	}
}

function lineEndingNameToValue(lineEnding: string): string {
	return normalizeLineEnding(lineEnding);
}

function containsUppercaseAndNoLowercase(cell: string): boolean {
	let hasUppercase = false;

	for (let i = 0; i < cell.length; i++) {
		const charCode = cell.charCodeAt(i);

		if (charCode >= 65 && charCode <= 90) {
			hasUppercase = true;
		} else if (charCode >= 97 && charCode <= 122) {
			return false;
		}
	}

	return hasUppercase;
}

function containsLowercase(cell: string): boolean {
	for (let i = 0; i < cell.length; i++) {
		const charCode = cell.charCodeAt(i);
		if (charCode >= 97 && charCode <= 122) {
			return true;
		}
	}

	return false;
}

function isWhitespace(charCode: number): boolean {
	return charCode === 32 || (charCode >= 9 && charCode <= 13);
}
