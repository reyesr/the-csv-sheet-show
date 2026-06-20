import { CsvTokenizedPartType, CsvTokenizer } from './CsvTokenizer';

export function splitCells(line: string, separator: string): string[] {
	if (separator.length === 0) {
		return [line];
	}

	const cells: string[] = [];
	let currentCell = '';
	const tokenizer = new CsvTokenizer(line);

	while (true) {
		const part = tokenizer.parse();

		if (part.type === CsvTokenizedPartType.END_OF_CONTENT) {
			cells.push(currentCell);
			return cells;
		}

		if (part.type === CsvTokenizedPartType.QUOTED) {
			currentCell += line.slice(part.start, part.end).replace(/""/g, '"');
			continue;
		}

		let segmentStart = part.start;
		for (let i = part.start; i < part.end; i++) {
			if (!line.startsWith(separator, i)) {
				continue;
			}

			currentCell += line.slice(segmentStart, i);
			cells.push(currentCell);
			currentCell = '';
			i += separator.length - 1;
			segmentStart = i + 1;
		}

		currentCell += line.slice(segmentStart, part.end);
	}
}
