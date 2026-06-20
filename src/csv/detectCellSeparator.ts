import { CsvTokenizedPartType, CsvTokenizer } from './CsvTokenizer';

const CANDIDATE_SEPARATORS = [',', ';', '\t', '|'] as const;

interface SeparatorScore {
	separator: string;
	consistentRows: number;
	modeCount: number;
	totalCount: number;
}

interface RowStats {
	counts: number[];
	hasContent: boolean;
}

/**
 * Detects the most likely CSV cell separator in content.
 * The content is tokenized first so quoted ranges are ignored, then unquoted ranges are split
 * into rows using the provided line ending. Candidate separators are scored by frequency and
 * consistency: prefer the separator that appears with the same positive count on the most rows,
 * then prefer the higher per-row count, then the highest total count.
 */
export function detectCellSeparator(content: string, lineEndings: string): string {
	const lineEnding = normalizeLineEnding(lineEndings);
	const rows: RowStats[] = [createRowStats()];
	const tokenizer = new CsvTokenizer(content);

	while (true) {
		const part = tokenizer.parse();

		if (part.type === CsvTokenizedPartType.END_OF_CONTENT) {
			break;
		}

		if (part.type === CsvTokenizedPartType.QUOTED) {
			rows[rows.length - 1].hasContent = true;
			continue;
		}

		processUnquotedPart(content, part.start, part.end, lineEnding, rows);
	}

	const contentRows = rows.filter(row => row.hasContent);
	if (contentRows.length === 0) {
		return CANDIDATE_SEPARATORS[0];
	}

	return CANDIDATE_SEPARATORS
		.map((separator, index) => scoreSeparator(separator, index, contentRows))
		.sort(compareScores)[0].separator;
}

function processUnquotedPart(content: string, start: number, end: number, lineEnding: string, rows: RowStats[]): void {
	for (let i = start; i < end; i++) {
		if (content.startsWith(lineEnding, i)) {
			rows.push(createRowStats());
			i += lineEnding.length - 1;
			continue;
		}

		const currentRow = rows[rows.length - 1];
		currentRow.hasContent = true;

		for (let separatorIndex = 0; separatorIndex < CANDIDATE_SEPARATORS.length; separatorIndex++) {
			if (content[i] === CANDIDATE_SEPARATORS[separatorIndex]) {
				currentRow.counts[separatorIndex] += 1;
				break;
			}
		}
	}
}

function scoreSeparator(separator: string, separatorIndex: number, rows: RowStats[]): SeparatorScore {
	const rowCounts = rows.map(row => row.counts[separatorIndex]);
	const totalCount = rowCounts.reduce((sum, count) => sum + count, 0);

	if (totalCount === 0) {
		return {
			separator,
			consistentRows: 0,
			modeCount: 0,
			totalCount: 0
		};
	}

	let modeCount = 0;
	let consistentRows = 0;
	const frequencies = new Map<number, number>();

	for (const count of rowCounts) {
		if (count === 0) {
			continue;
		}

		const matchingRows = (frequencies.get(count) ?? 0) + 1;
		frequencies.set(count, matchingRows);

		if (matchingRows > consistentRows || (matchingRows === consistentRows && count > modeCount)) {
			consistentRows = matchingRows;
			modeCount = count;
		}
	}

	return {
		separator,
		consistentRows,
		modeCount,
		totalCount
	};
}

function compareScores(a: SeparatorScore, b: SeparatorScore): number {
	if (a.consistentRows !== b.consistentRows) {
		return b.consistentRows - a.consistentRows;
	}

	if (a.modeCount !== b.modeCount) {
		return b.modeCount - a.modeCount;
	}

	return b.totalCount - a.totalCount;
}

function createRowStats(): RowStats {
	return {
		counts: CANDIDATE_SEPARATORS.map(() => 0),
		hasContent: false
	};
}

function normalizeLineEnding(lineEndings: string): string {
	switch (lineEndings) {
		case 'CRLF':
			return '\r\n';
		case 'CR':
			return '\r';
		case 'LF':
			return '\n';
		case '':
			return '\n';
		default:
			return lineEndings;
	}
}
