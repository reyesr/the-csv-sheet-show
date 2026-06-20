/// <reference types="mocha" />
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CsvDocumentChanges } from '../../CsvDocumentChanges';
import { DecimalSeparator, type CsvFileConfig } from '../../csv/CsvFileConfig';
import { writeCsv, writeCsvAndReplace, type CsvWriteSource } from '../../io/CsvWriter';

function configWith(overrides: Partial<CsvFileConfig> = {}): CsvFileConfig {
	return { separator: ',', encoding: 'utf8', lineEnding: '\n', decimalSeparator: DecimalSeparator.DOT, hasHeader: true, ...overrides };
}

interface Scenario {
	/** Physical file rows, including the header at index 0 when hasHeader is true. */
	physicalRows: string[];
	config?: Partial<CsvFileConfig>;
	changes?: CsvDocumentChanges;
	/** Original file contents — controls the trailing-newline probe. */
	originalBytes: Buffer | string;
}

suite('CsvWriter', () => {
	let tempDir: string;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-writer-test-'));
	});

	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function buildSource(scenario: Scenario): { source: CsvWriteSource; target: string; encoding: string } {
		const config = configWith(scenario.config);
		const changes = scenario.changes ?? new CsvDocumentChanges();
		const headerOffset = config.hasHeader ? 1 : 0;
		const baseDataRows = Math.max(0, scenario.physicalRows.length - headerOffset);

		const originalPath = path.join(tempDir, 'original.csv');
		fs.writeFileSync(originalPath, scenario.originalBytes);

		const source: CsvWriteSource = {
			config,
			totalRows: baseDataRows + changes.getRowCountDelta(),
			originalPath,
			pageSize: 2, // small, to exercise the chunked write loop across multiple blocks
			changes,
			readPhysical: (physicalRow, count) => scenario.physicalRows.slice(physicalRow, physicalRow + count),
			displayedToPhysical: displayedRow => displayedRow + headerOffset,
		};

		return { source, target: path.join(tempDir, 'out.csv'), encoding: config.encoding };
	}

	function readBack(target: string, encoding: string): string {
		const buffer = fs.readFileSync(target);
		return encoding === 'latin1' ? buffer.toString('latin1') : buffer.toString('utf8');
	}

	test('copies header and base rows through verbatim when there are no edits', () => {
		const { source, target, encoding } = buildSource({
			physicalRows: ['h0,h1', 'a,b', 'c,d'],
			originalBytes: 'h0,h1\na,b\nc,d',
		});
		writeCsv(target, source);
		assert.strictEqual(readBack(target, encoding), 'h0,h1\na,b\nc,d');
	});

	test('re-serializes an edited header cell', () => {
		const changes = new CsvDocumentChanges();
		changes.setHeaderContent(1, 'H1');
		const { source, target, encoding } = buildSource({
			physicalRows: ['h0,h1', 'a,b'],
			originalBytes: 'h0,h1\na,b',
			changes,
		});
		writeCsv(target, source);
		assert.strictEqual(readBack(target, encoding), 'h0,H1\na,b');
	});

	test('re-serializes only the edited base row', () => {
		const changes = new CsvDocumentChanges();
		changes.setCellContent(0, 1, 'Z'); // displayed row 0 -> base row 0
		const { source, target, encoding } = buildSource({
			physicalRows: ['h0,h1', 'a,b', 'c,d'],
			originalBytes: 'h0,h1\na,b\nc,d',
			changes,
		});
		writeCsv(target, source);
		assert.strictEqual(readBack(target, encoding), 'h0,h1\na,Z\nc,d');
	});

	test('writes inserted rows from the change overlay', () => {
		const changes = new CsvDocumentChanges();
		changes.insertRow(0);
		changes.setCellContent(0, 0, 'NEW');
		changes.setCellContent(0, 1, 'ROW');
		const { source, target, encoding } = buildSource({
			physicalRows: ['h0,h1', 'a,b'],
			originalBytes: 'h0,h1\na,b',
			changes,
		});
		writeCsv(target, source);
		assert.strictEqual(readBack(target, encoding), 'h0,h1\nNEW,ROW\na,b');
	});

	test('omits rows removed by a delete-range', () => {
		const changes = new CsvDocumentChanges();
		changes.deleteRowRange(0, 1); // drop displayed row 0 ('a,b')
		const { source, target, encoding } = buildSource({
			physicalRows: ['h0,h1', 'a,b', 'c,d'],
			originalBytes: 'h0,h1\na,b\nc,d',
			changes,
		});
		writeCsv(target, source);
		assert.strictEqual(readBack(target, encoding), 'h0,h1\nc,d');
	});

	test('preserves a trailing newline when the original had one', () => {
		const { source, target, encoding } = buildSource({
			physicalRows: ['h0,h1', 'a,b'],
			originalBytes: 'h0,h1\na,b\n',
		});
		writeCsv(target, source);
		assert.strictEqual(readBack(target, encoding), 'h0,h1\na,b\n');
	});

	test('writes a file without a header row when hasHeader is false', () => {
		const { source, target, encoding } = buildSource({
			physicalRows: ['a,b', 'c,d'],
			config: { hasHeader: false },
			originalBytes: 'a,b\nc,d',
		});
		writeCsv(target, source);
		assert.strictEqual(readBack(target, encoding), 'a,b\nc,d');
	});

	test('prepends an inserted header on a header-less file, materializing empties to column_N', () => {
		const changes = new CsvDocumentChanges();
		changes.insertHeader(['', '', '']);
		changes.setHeaderContent(1, 'Hello');
		const { source, target, encoding } = buildSource({
			physicalRows: ['a,b,c', 'd,e,f'],
			config: { hasHeader: false },
			originalBytes: 'a,b,c\nd,e,f',
			changes,
		});
		writeCsv(target, source);
		// The added header is prepended; physical row 0 stays data; unnamed cells become column_N.
		assert.strictEqual(readBack(target, encoding), 'column_1,Hello,column_3\na,b,c\nd,e,f');
	});

	test('prepends a fully-default header when an inserted header has no names', () => {
		const changes = new CsvDocumentChanges();
		changes.insertHeader(['', '', '']);
		const { source, target, encoding } = buildSource({
			physicalRows: ['a,b,c', 'd,e,f'],
			config: { hasHeader: false },
			originalBytes: 'a,b,c\nd,e,f',
			changes,
		});
		writeCsv(target, source);
		assert.strictEqual(readBack(target, encoding), 'column_1,column_2,column_3\na,b,c\nd,e,f');
	});

	test('honors a non-comma separator, CRLF line ending and a non-UTF-8 encoding', () => {
		const changes = new CsvDocumentChanges();
		changes.setCellContent(0, 1, 'caña'); // forces re-serialization with the configured separator
		const { source, target, encoding } = buildSource({
			physicalRows: ['h0;h1', 'a;b', 'c;d'],
			config: { separator: ';', lineEnding: '\r\n', encoding: 'latin1' },
			originalBytes: Buffer.from('h0;h1\r\na;b\r\nc;d', 'latin1'),
			changes,
		});
		writeCsv(target, source);
		assert.strictEqual(readBack(target, encoding), 'h0;h1\r\na;caña\r\nc;d');
	});

	test('writeCsvAndReplace overwrites a pre-existing destination', () => {
		const { source, target, encoding } = buildSource({
			physicalRows: ['h0,h1', 'a,b'],
			originalBytes: 'h0,h1\na,b',
		});
		fs.writeFileSync(target, 'STALE CONTENT');
		writeCsvAndReplace(target, source);
		assert.strictEqual(readBack(target, encoding), 'h0,h1\na,b');
		assert.strictEqual(fs.existsSync(path.join(tempDir, `.${path.basename(target)}.csv-sheet-show.tmp`)), false);
	});
});
