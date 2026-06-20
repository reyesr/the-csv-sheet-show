export function parseNaiveCsv(text: string): string[][] {
	const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const lines = normalized.split('\n');
	if (lines.at(-1) === '') {
		lines.pop();
	}

	return lines.map(parseLine);
}

function parseLine(line: string): string[] {
	const cells: string[] = [];
	let cell = '';
	let inQuotes = false;

	for (let index = 0; index < line.length; index++) {
		const char = line[index];
		const nextChar = line[index + 1];

		if (char === '"') {
			if (inQuotes && nextChar === '"') {
				cell += '"';
				index++;
				continue;
			}

			inQuotes = !inQuotes;
			continue;
		}

		if (char === ',' && !inQuotes) {
			cells.push(cell);
			cell = '';
			continue;
		}

		cell += char;
	}

	cells.push(cell);
	return cells;
}
