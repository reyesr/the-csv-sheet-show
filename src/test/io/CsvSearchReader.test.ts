/// <reference types="mocha" />
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CsvFileConfig, DecimalSeparator } from '../../csv/CsvFileConfig';
import { splitCells } from '../../csv/splitCells';
import { CsvMappingReader, CsvMappingReaderStats } from '../../io/CsvMappingReader';
import { CsvSearchOptions, CsvSearchReader, CsvSearchRow, CsvSearchUpdate } from '../../io/CsvSearchReader';

const CONFIG: CsvFileConfig = {
	separator: ',',
	encoding: 'utf8',
	lineEnding: '\n',
	decimalSeparator: DecimalSeparator.DOT,
	hasHeader: false
};

suite('CsvSearchReader', () => {
	test('finds plain text matches with character ranges', async () => {
		const { reader, cleanup } = await openCsv('alpha,beta\nneedle here,beta needle\nnone,other');
		try {
			const result = await runSearch(reader, 'needle', { matchCase: false, regex: false });
			assert.deepStrictEqual(result.matchingRows, [1]);
			assert.deepStrictEqual(result.rows, [
				{
					offset: 1,
					cells: ['needle here', 'beta needle'],
					matches: [
						{ rowIndex: 0, cellIndex: 0, start: 0, end: 6 },
						{ rowIndex: 0, cellIndex: 1, start: 5, end: 11 }
					]
				}
			]);
		} finally {
			cleanup();
		}
	});

	test('respects case-sensitive plain text search', async () => {
		const { reader, cleanup } = await openCsv('Needle\nneedle\nNEEDLE');
		try {
			const result = await runSearch(reader, 'needle', { matchCase: true, regex: false });
			assert.deepStrictEqual(result.matchingRows, [1]);
		} finally {
			cleanup();
		}
	});

	test('supports regex search', async () => {
		const { reader, cleanup } = await openCsv('item-1\nitem-22\nother');
		try {
			const result = await runSearch(reader, 'item-\\d+', { matchCase: false, regex: true });
			assert.deepStrictEqual(result.matchingRows, [0, 1]);
		} finally {
			cleanup();
		}
	});

	test('restricts matching to selected columns', async () => {
		const { reader, cleanup } = await openCsv('needle,plain\nplain,needle\nneedle,needle');
		try {
			const result = await runSearch(reader, 'needle', { matchCase: false, regex: false }, { selectedColumns: [1] });
			// Only rows whose column 1 matches are included; row 0 (match only in column 0) is excluded.
			assert.deepStrictEqual(result.matchingRows, [1, 2]);
		} finally {
			cleanup();
		}
	});

	test('throws for invalid regex from the constructor', async () => {
		const { reader, cleanup } = await openCsv('value');
		try {
			assert.throws(() => new CsvSearchReader(reader, '[', { matchCase: false, regex: true }, {
				initialRowsExpected: 10,
				readRows: (offset, count) => reader.readRange(offset, count).map(row => splitCells(row, CONFIG.separator))
			}), SyntaxError);
		} finally {
			cleanup();
		}
	});

	test('does not emit after cancellation', async () => {
		const { reader, stats, cleanup } = await openCsv('needle\nneedle');
		try {
			const search = new CsvSearchReader(reader, 'needle', { matchCase: false, regex: false }, {
				initialRowsExpected: 10,
				readRows: (offset, count) => reader.readRange(offset, count).map(row => splitCells(row, CONFIG.separator))
			});
			const updates: CsvSearchUpdate[] = [];
			let done = false;
			search.on('update', update => updates.push(update));
			search.on('done', () => { done = true; });

			search.cancel();
			search.searchAvailableRows(stats.readableRowCount, stats.isFinal);
			await nextTick();

			assert.deepStrictEqual(updates, []);
			assert.strictEqual(done, false);
		} finally {
			cleanup();
		}
	});

	test('accumulates every matching offset but streams at most initialRowsExpected rows', async () => {
		const rows = Array.from({ length: 10 }, (_, index) => `needle-${index}`);
		const { reader, cleanup } = await openCsv(rows.join('\n'));
		try {
			const result = await runSearch(reader, 'needle', { matchCase: false, regex: false }, { initialRowsExpected: 3 });
			assert.strictEqual(result.matchingRows.length, 10);
			assert.deepStrictEqual(result.rows.map(row => row.offset), [0, 1, 2]);
			const finalUpdate = result.updates[result.updates.length - 1];
			assert.strictEqual(finalUpdate.isFinal, true);
			assert.strictEqual(finalUpdate.totalCount, 10);
		} finally {
			cleanup();
		}
	});

	test('startFromRow scans forward then wraps to cover the whole file', async () => {
		const { reader, cleanup } = await openCsv('a\nneedle\nb\nc\nneedle\nd');
		try {
			const result = await runSearch(reader, 'needle', { matchCase: false, regex: false }, { startFromRow: 3 });
			// Forward pass [3,6) finds row 4 first; wrap pass [0,3) then finds row 1.
			assert.deepStrictEqual(result.matchingRows, [4, 1]);
		} finally {
			cleanup();
		}
	});

	test('emits a final empty update when nothing matches', async () => {
		const { reader, cleanup } = await openCsv('alpha\nbeta\ngamma');
		try {
			const result = await runSearch(reader, 'needle', { matchCase: false, regex: false });
			assert.deepStrictEqual(result.matchingRows, []);
			assert.deepStrictEqual(result.rows, []);
			const finalUpdate = result.updates[result.updates.length - 1];
			assert.strictEqual(finalUpdate.isFinal, true);
			assert.strictEqual(finalUpdate.totalCount, 0);
		} finally {
			cleanup();
		}
	});

	test('searches across multiple max-size pages', async () => {
		const rows = Array.from({ length: 20_050 }, (_, index) => index % 10_000 === 0 ? `needle-${index}` : `row-${index}`);
		const { reader, cleanup } = await openCsv(rows.join('\n'));
		try {
			const result = await runSearch(reader, 'needle', { matchCase: false, regex: false });
			assert.deepStrictEqual(result.matchingRows, [0, 10_000, 20_000]);
		} finally {
			cleanup();
		}
	});
});

interface SearchResult {
	matchingRows: number[];
	rows: CsvSearchRow[];
	updates: CsvSearchUpdate[];
}

function runSearch(
	reader: CsvMappingReader,
	query: string,
	options: CsvSearchOptions,
	overrides: { initialRowsExpected?: number; startFromRow?: number; selectedColumns?: number[] } = {}
): Promise<SearchResult> {
	return new Promise((resolve, reject) => {
		const search = new CsvSearchReader(reader, query, options, {
			initialRowsExpected: overrides.initialRowsExpected ?? 1_000_000,
			startFromRow: overrides.startFromRow,
			selectedColumns: overrides.selectedColumns,
			readRows: (offset, count) => reader.readRange(offset, count).map(row => splitCells(row, CONFIG.separator))
		});
		const rows: CsvSearchRow[] = [];
		const updates: CsvSearchUpdate[] = [];
		search.on('update', update => {
			updates.push(update);
			rows.push(...update.rows);
		});
		search.on('error', reject);
		search.on('done', () => resolve({ matchingRows: [...search.getMatchingRows()], rows, updates }));
		search.searchAvailableRows(reader.getReadableRowCount(), true);
	});
}

function nextTick(): Promise<void> {
	return new Promise(resolve => setImmediate(resolve));
}

async function openCsv(content: string): Promise<{ reader: CsvMappingReader; stats: CsvMappingReaderStats; cleanup: () => void }> {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-search-reader-'));
	const csvPath = path.join(tempDir, 'search.csv');
	fs.writeFileSync(csvPath, content, 'utf8');

	const reader = new CsvMappingReader(1024, 1000, () => CONFIG);
	const statsPromise = waitForEnd(reader);
	reader.open(csvPath);
	const stats = await statsPromise;

	return {
		reader,
		stats,
		cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true })
	};
}

function waitForEnd(reader: CsvMappingReader): Promise<CsvMappingReaderStats> {
	return new Promise((resolve, reject) => {
		reader.once('end', resolve);
		reader.once('error', reject);
	});
}
