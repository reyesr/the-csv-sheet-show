/// <reference types="mocha" />
import * as assert from 'assert';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import * as os from 'os';
import * as path from 'path';
import { CsvFileConfig, DecimalSeparator } from '../../csv/CsvFileConfig';
import { CsvMappingReader, CsvMappingReaderError, CsvMappingReaderStats } from '../../io/CsvMappingReader';
import { CsvLoadErrorReason } from '../../shared/messages/errors';

interface CsvFixtureMetadata {
	source: string;
	'row-count': number;
	'column-count': number;
	'has-header': boolean;
	encoding: string;
	'line-ending': string;
	'cell-separator': string;
	'decimal-separator': string;
	mapping: number[];
}

interface CsvFixture {
	category: string;
	name: string;
	csvPath: string;
	metadataPath: string;
	metadata: CsvFixtureMetadata;
}

interface DynamicReadRangeFixture {
	'row-count': number;
	'column-count': number;
	encoding: string;
	'line-ending': string;
	'cell-separator': string;
	'has-header': boolean;
	'decimal-separator': string;
	'special-rows': Record<string, string[]>;
	'page-assertions': Array<{
		offset: number;
		'row-count': number;
	}>;
}

const FIXTURE_ROOT = path.resolve(__dirname, '../../../test-data/csv-mapping-reader');

suite('CsvMappingReader', () => {
	const fixtures = loadFixtures(FIXTURE_ROOT);

	for (const fixture of fixtures) {
		test(`${fixture.category}/${fixture.name} maps rows and reads ranges`, async () => {
			const chunkSize = getChunkSize(fixture.metadata);
			const fileSize = fs.statSync(fixture.csvPath).size;
			assert.ok(fileSize >= chunkSize * 3, `${fixture.csvPath} must be at least 3 chunks`);

			const reader = new CsvMappingReader(chunkSize, 1000, () => metadataToConfig(fixture.metadata));
			const statsEvents: CsvMappingReaderStats[] = [];
			const finalStatsPromise = waitForEnd(reader, statsEvents);

			reader.open(fixture.csvPath);
			const finalStats = await finalStatsPromise;

			assert.ok(statsEvents.length >= 3, 'expected at least 3 stats events');
			assert.ok(statsEvents.every(stats => !stats.isFinal), 'chunk stats must be temporary');
			assert.strictEqual(finalStats.isFinal, true);
			assert.strictEqual(finalStats.rowCount, fixture.metadata['row-count']);
			assert.strictEqual(finalStats.totalBytesRead, fileSize);
			assert.strictEqual(finalStats.totalSizeInBytes, fileSize);
			assertConfigMatchesMetadata(finalStats.config, fixture.metadata);
			assert.deepStrictEqual([...reader.getMapping()], fixture.metadata.mapping);

			assertReadRange(reader, fixture, 0, 3);
			assertReadRange(reader, fixture, Math.floor(fixture.metadata.mapping.length / 2), 5);
			assertReadRange(reader, fixture, Math.max(0, fixture.metadata.mapping.length - 4), 10);
		});
	}

		test('auto-detects config from the first chunk when config is omitted', async () => {
		const fixture = fixtures.find(item => item.name === 'comma_lf_header_dot_6cols');
		assert.ok(fixture);

		const reader = new CsvMappingReader(getChunkSize(fixture.metadata));
		const finalStatsPromise = waitForEnd(reader, []);

		reader.open(fixture.csvPath);
		const finalStats = await finalStatsPromise;

		assert.strictEqual(finalStats.config.separator, fixture.metadata['cell-separator']);
		assert.strictEqual(finalStats.config.lineEnding, metadataLineEndingToValue(fixture.metadata['line-ending']));
		assert.strictEqual(finalStats.config.decimalSeparator, metadataDecimalSeparatorToValue(fixture.metadata['decimal-separator']));
		assert.strictEqual(finalStats.config.hasHeader, fixture.metadata['has-header']);
		assert.deepStrictEqual([...reader.getMapping()], fixture.metadata.mapping);
	});

	test('emits first-page before end when enough rows are mapped', async () => {
		const fixture = fixtures.find(item => item.name === 'comma_lf_header_dot_6cols');
		assert.ok(fixture);

		const reader = new CsvMappingReader(getChunkSize(fixture.metadata), 100, () => metadataToConfig(fixture.metadata));
		const events: string[] = [];
		const firstPagePromise = new Promise<CsvMappingReaderStats>((resolve, reject) => {
			reader.once('first-page', stats => {
				events.push('first-page');
				resolve(stats);
			});
			reader.once('error', reject);
		});
		const endPromise = new Promise<CsvMappingReaderStats>((resolve, reject) => {
			reader.once('end', stats => {
				events.push('end');
				resolve(stats);
			});
			reader.once('error', reject);
		});

		reader.open(fixture.csvPath);
		const firstPageStats = await firstPagePromise;
		const finalStats = await endPromise;

		assert.strictEqual(events[0], 'first-page');
		assert.strictEqual(events[1], 'end');
		assert.strictEqual(firstPageStats.isFinal, false);
		assert.ok(firstPageStats.rowCount >= 100);
		assert.strictEqual(finalStats.isFinal, true);
		assert.strictEqual(finalStats.rowCount, fixture.metadata['row-count']);
	});

	test('emits first-page as final for files smaller than the first page', async () => {
		const fixture = fixtures.find(item => item.name === 'comma_lf_header_dot_6cols');
		assert.ok(fixture);

		const reader = new CsvMappingReader(getChunkSize(fixture.metadata), fixture.metadata['row-count'] + 100, () => metadataToConfig(fixture.metadata));
		const firstPagePromise = new Promise<CsvMappingReaderStats>((resolve, reject) => {
			reader.once('first-page', resolve);
			reader.once('error', reject);
		});
		const endPromise = new Promise<CsvMappingReaderStats>((resolve, reject) => {
			reader.once('end', resolve);
			reader.once('error', reject);
		});

		reader.open(fixture.csvPath);
		const firstPageStats = await firstPagePromise;
		const finalStats = await endPromise;

		assert.strictEqual(firstPageStats.isFinal, true);
		assert.strictEqual(firstPageStats.rowCount, fixture.metadata['row-count']);
		assert.strictEqual(finalStats.isFinal, true);
		assert.strictEqual(finalStats.rowCount, firstPageStats.rowCount);
	});

	test('readRange returns expected pages for dynamically created predefined CSV content', async () => {
		const fixturePath = path.resolve(__dirname, '../../../test-data/csv-mapping-reader-dynamic-read-range.json');
		const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as DynamicReadRangeFixture;
		assert.ok(fixture['row-count'] >= 100000);

		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-mapping-reader-'));
		const csvPath = path.join(tempDir, 'dynamic-read-range.csv');

		try {
			fs.writeFileSync(csvPath, buildDynamicCsv(fixture), fixture.encoding as BufferEncoding);

			const reader = new CsvMappingReader(16 * 1024, 1000, () => dynamicFixtureToConfig(fixture));
			const finalStatsPromise = waitForEnd(reader, []);
			reader.open(csvPath);
			const finalStats = await finalStatsPromise;

			assert.strictEqual(finalStats.rowCount, fixture['row-count']);

			for (const page of fixture['page-assertions']) {
				const expected = expectedDynamicRows(fixture, page.offset, page['row-count']);
				assert.deepStrictEqual(reader.readRange(page.offset, page['row-count']), expected);
			}
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('emits typed error when selected line ending is absent after 1 MiB', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-mapping-reader-'));
		const csvPath = path.join(tempDir, 'missing-line-ending.csv');

		try {
			fs.writeFileSync(csvPath, Buffer.alloc(CsvMappingReader.MAX_BYTES_WITHOUT_LINE_ENDING + 1, 65));

			const reader = new CsvMappingReader(256 * 1024, 1000, () => ({
				separator: ',',
				encoding: 'utf8',
				lineEnding: '\n',
				decimalSeparator: DecimalSeparator.DOT,
				hasHeader: false
			}));
			const errorPromise = waitForError(reader);

			reader.open(csvPath);
			const error = await errorPromise;

			assert.ok(error instanceof CsvMappingReaderError);
			assert.strictEqual(error.reason, CsvLoadErrorReason.SelectedLineEndingNotFound);
			assert.deepStrictEqual([...reader.getMapping()], [0]);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('does not emit headers before a row boundary exists', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-mapping-reader-'));
		const csvPath = path.join(tempDir, 'missing-line-ending-header.csv');
		let didEmitHeaders = false;

		try {
			fs.writeFileSync(csvPath, Buffer.alloc(CsvMappingReader.MAX_BYTES_WITHOUT_LINE_ENDING + 1, 65));

			const reader = new CsvMappingReader(256 * 1024, 1000, () => ({
				separator: ',',
				encoding: 'utf8',
				lineEnding: '\n',
				decimalSeparator: DecimalSeparator.DOT,
				hasHeader: true
			}));
			reader.once('headers', () => { didEmitHeaders = true; });
			const errorPromise = waitForError(reader);

			reader.open(csvPath);
			const error = await errorPromise;

			assert.ok(error instanceof CsvMappingReaderError);
			assert.strictEqual(error.reason, CsvLoadErrorReason.SelectedLineEndingNotFound);
			assert.strictEqual(didEmitHeaders, false);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('emits headers after the first row boundary is mapped', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-mapping-reader-'));
		const csvPath = path.join(tempDir, 'split-header.csv');
		let headerContent: string | null = null;

		try {
			fs.writeFileSync(csvPath, 'h1,h2\n1,2', 'utf8');

			const reader = new CsvMappingReader(4, 1000, () => ({
				separator: ',',
				encoding: 'utf8',
				lineEnding: '\n',
				decimalSeparator: DecimalSeparator.DOT,
				hasHeader: true
			}));
			reader.once('headers', header => {
				headerContent = Buffer.isBuffer(header.content)
					? header.content.toString('utf8')
					: header.content;
			});
			const finalStatsPromise = waitForEnd(reader, []);

			reader.open(csvPath);
			await finalStatsPromise;

			assert.strictEqual(headerContent, 'h1,h2\n');
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('uses the config from setDetectExistingConfig as the detection hint', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-mapping-reader-'));
		const csvPath = path.join(tempDir, 'existing-config.csv');

		try {
			fs.writeFileSync(csvPath, 'name;amount\nalpha;1\nbeta;2\n', 'utf8');

			// Distinct from what auto-detection would produce (it would pick decimalSeparator BOTH here).
			const existing: CsvFileConfig = {
				separator: ';',
				encoding: 'utf8',
				lineEnding: '\n',
				decimalSeparator: DecimalSeparator.COMMAS,
				hasHeader: true
			};
			let seenFilepath: string | undefined;
			let seenChunkIsBuffer = false;

			const configDetector = (filepath: string, chunk: Buffer): CsvFileConfig | undefined => {
				seenFilepath = filepath;
				seenChunkIsBuffer = Buffer.isBuffer(chunk);
				return existing;
			};
			const reader = new CsvMappingReader(64 * 1024, 1000, configDetector);
			const finalStatsPromise = waitForEnd(reader, []);

			reader.open(csvPath);
			const finalStats = await finalStatsPromise;

			assert.strictEqual(seenFilepath, csvPath);
			assert.strictEqual(seenChunkIsBuffer, true);
			assert.deepStrictEqual(finalStats.config, existing);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('falls back to auto-detection when setDetectExistingConfig returns undefined', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-mapping-reader-'));
		const csvPath = path.join(tempDir, 'no-existing-config.csv');

		try {
			fs.writeFileSync(csvPath, 'name,amount\nalpha,1.5\nbeta,2.5\n', 'utf8');

			const reader = new CsvMappingReader(64 * 1024, 1000, () => undefined);
			const finalStatsPromise = waitForEnd(reader, []);

			reader.open(csvPath);
			const finalStats = await finalStatsPromise;

			assert.strictEqual(finalStats.config.separator, ',');
			assert.strictEqual(finalStats.config.decimalSeparator, DecimalSeparator.DOT);
			assert.strictEqual(finalStats.config.hasHeader, true);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('does not treat a partial custom line ending prefix as a match', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-mapping-reader-'));
		const csvPath = path.join(tempDir, 'partial-prefix-only.csv');

		try {
			fs.writeFileSync(csvPath, Buffer.alloc(CsvMappingReader.MAX_BYTES_WITHOUT_LINE_ENDING + 1, 97));

			const reader = new CsvMappingReader(256 * 1024, 1000, () => ({
				separator: ',',
				encoding: 'utf8',
				lineEnding: 'aaX',
				decimalSeparator: DecimalSeparator.DOT,
				hasHeader: false
			}));
			const errorPromise = waitForError(reader);

			reader.open(csvPath);
			const error = await errorPromise;

			assert.ok(error instanceof CsvMappingReaderError);
			assert.strictEqual(error.reason, CsvLoadErrorReason.SelectedLineEndingNotFound);
			assert.deepStrictEqual([...reader.getMapping()], [0]);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('maps custom line endings split across chunks', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-mapping-reader-'));
		const csvPath = path.join(tempDir, 'custom-split-line-ending.csv');

		try {
			fs.writeFileSync(csvPath, 'aXYZbXYZc', 'utf8');

			const reader = new CsvMappingReader(3, 1000, () => ({
				separator: ',',
				encoding: 'utf8',
				lineEnding: 'XYZ',
				decimalSeparator: DecimalSeparator.DOT,
				hasHeader: false
			}));
			const finalStatsPromise = waitForEnd(reader, []);

			reader.open(csvPath);
			const finalStats = await finalStatsPromise;

			assert.strictEqual(finalStats.rowCount, 3);
			assert.deepStrictEqual([...reader.getMapping()], [0, 4, 8]);
			assert.deepStrictEqual(reader.readRange(0, 3), ['a', 'b', 'c']);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('ignores stale stream events after reopening before the previous stream finishes', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-mapping-reader-'));
		const firstPath = path.join(tempDir, 'many-lf-rows.csv');
		const secondPath = path.join(tempDir, 'missing-line-ending.csv');
		const config: CsvFileConfig = {
			separator: ',',
			encoding: 'utf8',
			lineEnding: '\n',
			decimalSeparator: DecimalSeparator.DOT,
			hasHeader: false
		};
		const changedConfig: CsvFileConfig = { ...config, lineEnding: 'aaX' };

		try {
			fs.writeFileSync(firstPath, Buffer.from('a\n'.repeat(CsvMappingReader.MAX_BYTES_WITHOUT_LINE_ENDING), 'utf8'));
			fs.writeFileSync(secondPath, Buffer.alloc(CsvMappingReader.MAX_BYTES_WITHOUT_LINE_ENDING + 1, 65));

			const reader = new CsvMappingReader(16 * 1024, 1000, () => config);
			const firstStatsPromise = waitForStats(reader);

			reader.open(firstPath);
			await firstStatsPromise;

			reader.setOpenConfig(changedConfig);
			const errorPromise = waitForError(reader);
			reader.open(secondPath);
			const error = await errorPromise;

			assert.ok(error instanceof CsvMappingReaderError);
			assert.strictEqual(error.reason, CsvLoadErrorReason.SelectedLineEndingNotFound);
			assert.deepStrictEqual([...reader.getMapping()], [0]);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('setOpenConfig takes precedence over auto-detection', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-mapping-reader-'));
		const csvPath = path.join(tempDir, 'data.csv');

		try {
			// This content would auto-detect as comma-separated with a header; force a config that
			// differs in every field so a passing assertion can only mean the forced config won.
			fs.writeFileSync(csvPath, 'a,b\n1,2\n3,4\n', 'utf8');
			const forced: CsvFileConfig = {
				separator: ';',
				encoding: 'latin1',
				lineEnding: '\n',
				decimalSeparator: DecimalSeparator.COMMAS,
				hasHeader: false
			};

			const reader = new CsvMappingReader(64 * 1024, 1000, () => undefined);
			const finalStatsPromise = waitForEnd(reader, []);

			reader.setOpenConfig(forced);
			reader.open(csvPath);
			const finalStats = await finalStatsPromise;

			assert.deepStrictEqual(finalStats.config, forced);
			assert.deepStrictEqual(reader.getConfig(), forced);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('allows small single-row files without line endings', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-mapping-reader-'));
		const csvPath = path.join(tempDir, 'single-row.csv');
		const size = CsvMappingReader.MAX_BYTES_WITHOUT_LINE_ENDING - 1;

		try {
			fs.writeFileSync(csvPath, Buffer.alloc(size, 65));

			const reader = new CsvMappingReader(256 * 1024, 1000, () => ({
				separator: ',',
				encoding: 'utf8',
				lineEnding: '\n',
				decimalSeparator: DecimalSeparator.DOT,
				hasHeader: false
			}));
			const finalStatsPromise = waitForEnd(reader, []);

			reader.open(csvPath);
			const finalStats = await finalStatsPromise;

			assert.strictEqual(finalStats.rowCount, 1);
			assert.strictEqual(finalStats.totalBytesRead, size);
			assert.strictEqual(finalStats.isFinal, true);
			assert.deepStrictEqual([...reader.getMapping()], [0]);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('dispose() cancels in-flight indexing and detaches listeners', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-mapping-reader-'));
		const csvPath = path.join(tempDir, 'dispose-cancel.csv');

		try {
			// Large enough that indexing spans many 16 KiB chunks and is still in flight at the first 'stats'.
			fs.writeFileSync(csvPath, Buffer.from('a\n'.repeat(300000), 'utf8'));

			const reader = new CsvMappingReader(16 * 1024, 1000, () => ({
				separator: ',',
				encoding: 'utf8',
				lineEnding: '\n',
				decimalSeparator: DecimalSeparator.DOT,
				hasHeader: false
			}));

			reader.open(csvPath);
			await waitForStats(reader); // first chunk mapped; the stream is still reading the rest

			const mappingLengthAtDispose = reader.getMapping().length;
			reader.dispose();

			// removeAllListeners(): the document's reader listeners are detached.
			assert.strictEqual(reader.listenerCount('stats'), 0);
			assert.strictEqual(reader.listenerCount('end'), 0);
			assert.strictEqual(reader.listenerCount('error'), 0);

			// Observe a quiet window with fresh listeners: cancellation means no further emits and the
			// mapping stops growing (queued stream callbacks bail via the bumped generation guard). Without
			// cancellation a 600 KB file would finish reading well inside this window and fire 'end'.
			let statsAfter = 0;
			let endAfter = 0;
			let errorAfter = 0;
			reader.on('stats', () => { statsAfter += 1; });
			reader.on('end', () => { endAfter += 1; });
			reader.on('error', () => { errorAfter += 1; });

			await new Promise<void>(resolve => { setTimeout(resolve, 150); });

			assert.strictEqual(statsAfter, 0, 'no stats should fire after dispose');
			assert.strictEqual(endAfter, 0, 'no end should fire after dispose');
			assert.strictEqual(errorAfter, 0, 'no error should fire after dispose');
			assert.strictEqual(reader.getMapping().length, mappingLengthAtDispose, 'mapping must not grow after dispose');
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});

function waitForEnd(reader: CsvMappingReader, statsEvents: CsvMappingReaderStats[]): Promise<CsvMappingReaderStats> {
	return new Promise((resolve, reject) => {
		reader.on('stats', stats => statsEvents.push(stats));
		reader.once('end', stats => resolve(stats));
		reader.once('error', reject);
	});
}

function waitForError(reader: CsvMappingReader): Promise<Error> {
	return new Promise((resolve, reject) => {
		reader.once('error', error => resolve(error));
		reader.once('end', () => reject(new Error('Expected CsvMappingReader to emit an error')));
	});
}

function waitForStats(reader: CsvMappingReader): Promise<CsvMappingReaderStats> {
	return new Promise((resolve, reject) => {
		const handleStats = (stats: CsvMappingReaderStats): void => {
			reader.off('error', handleError);
			resolve(stats);
		};
		const handleError = (error: Error): void => {
			reader.off('stats', handleStats);
			reject(error);
		};

		reader.once('stats', handleStats);
		reader.once('error', handleError);
	});
}

function buildDynamicCsv(fixture: DynamicReadRangeFixture): string {
	const lineEnding = metadataLineEndingToValue(fixture['line-ending']);
	const rows = new Array<string>(fixture['row-count']);

	for (let rowIndex = 0; rowIndex < fixture['row-count']; rowIndex++) {
		rows[rowIndex] = encodeDynamicRow(dynamicRowCells(fixture, rowIndex), fixture['cell-separator']);
	}

	return rows.join(lineEnding);
}

function expectedDynamicRows(fixture: DynamicReadRangeFixture, offset: number, rowCount: number): string[] {
	const rows: string[] = [];
	const end = Math.min(offset + rowCount, fixture['row-count']);

	for (let rowIndex = offset; rowIndex < end; rowIndex++) {
		rows.push(encodeDynamicRow(dynamicRowCells(fixture, rowIndex), fixture['cell-separator']));
	}

	return rows;
}

function dynamicRowCells(fixture: DynamicReadRangeFixture, rowIndex: number): string[] {
	const specialRow = fixture['special-rows'][String(rowIndex)];
	if (specialRow !== undefined) {
		return specialRow;
	}

	return [
		`row-${rowIndex}`,
		`name-${rowIndex % 100}`,
		`text-${rowIndex}`,
		String(rowIndex),
		((rowIndex % 10000) / 100).toFixed(2)
	];
}

function encodeDynamicRow(cells: string[], separator: string): string {
	return cells.map(cell => encodeDynamicCell(cell, separator)).join(separator);
}

function encodeDynamicCell(cell: string, separator: string): string {
	if (cell.includes(separator) || cell.includes('"') || cell.includes('\r') || cell.includes('\n')) {
		return `"${cell.replace(/"/g, '""')}"`;
	}

	return cell;
}

function dynamicFixtureToConfig(fixture: DynamicReadRangeFixture): CsvFileConfig {
	return {
		separator: fixture['cell-separator'],
		encoding: fixture.encoding,
		lineEnding: metadataLineEndingToValue(fixture['line-ending']),
		decimalSeparator: metadataDecimalSeparatorToValue(fixture['decimal-separator']),
		hasHeader: fixture['has-header']
	};
}

function assertReadRange(reader: CsvMappingReader, fixture: CsvFixture, rowOffset: number, rowCount: number): void {
	const expectedRows = expectedRowsFromMetadata(fixture, rowOffset, rowCount);
	const actualRows = reader.readRange(rowOffset, rowCount);

	assert.deepStrictEqual(actualRows, expectedRows);

	const lineEnding = metadataLineEndingToValue(fixture.metadata['line-ending']);
	for (const row of actualRows) {
		assert.ok(!row.endsWith(lineEnding), 'readRange rows should not include row-ending characters');
	}
}

function expectedRowsFromMetadata(fixture: CsvFixture, rowOffset: number, rowCount: number): string[] {
	const csv = fs.readFileSync(fixture.csvPath);
	const rows: string[] = [];
	const lineEnding = Buffer.from(metadataLineEndingToValue(fixture.metadata['line-ending']), 'ascii');
	const endRow = Math.min(rowOffset + rowCount, fixture.metadata.mapping.length);

	for (let rowIndex = rowOffset; rowIndex < endRow; rowIndex++) {
		const start = fixture.metadata.mapping[rowIndex];
		let end = rowIndex + 1 < fixture.metadata.mapping.length ? fixture.metadata.mapping[rowIndex + 1] : csv.length;

		if (endsWithBytes(csv, end, lineEnding)) {
			end -= lineEnding.length;
		}

		rows.push(iconv.decode(csv.subarray(start, end), fixture.metadata.encoding));
	}

	return rows;
}

function endsWithBytes(buffer: Buffer, end: number, suffix: Buffer): boolean {
	if (end < suffix.length) {
		return false;
	}

	for (let i = 0; i < suffix.length; i++) {
		if (buffer[end - suffix.length + i] !== suffix[i]) {
			return false;
		}
	}

	return true;
}

function loadFixtures(root: string): CsvFixture[] {
	const fixtures: CsvFixture[] = [];

	for (const metadataPath of listJsonFiles(root)) {
		const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as CsvFixtureMetadata;
		const csvPath = metadataPath.replace(/\.json$/, '.csv');
		const relativePath = path.relative(root, metadataPath);
		const category = relativePath.split(path.sep)[0];
		const name = path.basename(metadataPath, '.json');

		fixtures.push({ category, name, csvPath, metadataPath, metadata });
	}

	return fixtures.sort((a, b) => `${a.category}/${a.name}`.localeCompare(`${b.category}/${b.name}`));
}

function listJsonFiles(root: string): string[] {
	const files: string[] = [];

	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const fullPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...listJsonFiles(fullPath));
		} else if (entry.name.endsWith('.json')) {
			files.push(fullPath);
		}
	}

	return files;
}

function metadataToConfig(metadata: CsvFixtureMetadata): CsvFileConfig {
	return {
		separator: metadata['cell-separator'],
		encoding: metadata.encoding,
		lineEnding: metadataLineEndingToValue(metadata['line-ending']),
		decimalSeparator: metadataDecimalSeparatorToValue(metadata['decimal-separator']),
		hasHeader: metadata['has-header']
	};
}

function assertConfigMatchesMetadata(config: CsvFileConfig, metadata: CsvFixtureMetadata): void {
	assert.strictEqual(config.separator, metadata['cell-separator']);
	assert.strictEqual(normalizeEncoding(config.encoding), normalizeEncoding(metadata.encoding));
	assert.strictEqual(config.lineEnding, metadataLineEndingToValue(metadata['line-ending']));
	assert.strictEqual(config.decimalSeparator, metadataDecimalSeparatorToValue(metadata['decimal-separator']));
	assert.strictEqual(config.hasHeader, metadata['has-header']);
}

function metadataLineEndingToValue(lineEnding: string): string {
	switch (lineEnding) {
		case 'CRLF':
			return '\r\n';
		case 'CR':
			return '\r';
		case 'LF':
			return '\n';
		default:
			return lineEnding;
	}
}

function metadataDecimalSeparatorToValue(decimalSeparator: string): DecimalSeparator {
	switch (decimalSeparator) {
		case '.':
			return DecimalSeparator.DOT;
		case ',':
			return DecimalSeparator.COMMAS;
		default:
			return DecimalSeparator.BOTH;
	}
}

function getChunkSize(metadata: CsvFixtureMetadata): number {
	return metadata['column-count'] < 8 ? 16 * 1024 : 32 * 1024;
}

function normalizeEncoding(encoding: string): string {
	return encoding.toLowerCase().replace(/-/g, '');
}
