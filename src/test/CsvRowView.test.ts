/// <reference types="mocha" />
import * as assert from 'assert';
import { CsvDocumentChanges } from '../CsvDocumentChanges';
import { CsvRowView } from '../CsvRowView';
import { DecimalSeparator, type CsvFileConfig } from '../csv/CsvFileConfig';
import type { CsvMappingReader } from '../io/CsvMappingReader';

function configWith(overrides: Partial<CsvFileConfig> = {}): CsvFileConfig {
	return { separator: ',', encoding: 'utf8', lineEnding: '\n', decimalSeparator: DecimalSeparator.DOT, hasHeader: true, ...overrides };
}

/** Minimal stand-in for the slice of CsvMappingReader that CsvRowView consumes. */
class FakeReader {
	public readonly readRangeCalls: Array<[number, number]> = [];
	public readonly canReadRangeCalls: Array<[number, number]> = [];

	public constructor(
		private readonly physicalRows: string[],
		private readonly config: CsvFileConfig | null,
		private readonly readableRowCount = physicalRows.length,
		private readonly canReadPredicate?: (offset: number, count: number) => boolean,
	) { }

	public getConfig(): CsvFileConfig | null {
		return this.config;
	}

	public getReadableRowCount(): number {
		return this.readableRowCount;
	}

	public readRange(offset: number, count: number): string[] {
		this.readRangeCalls.push([offset, count]);
		return this.physicalRows.slice(offset, offset + count);
	}

	public canReadRange(offset: number, count: number): boolean {
		this.canReadRangeCalls.push([offset, count]);
		if (this.canReadPredicate !== undefined) {
			return this.canReadPredicate(offset, count);
		}
		return offset >= 0 && count >= 0 && offset + count <= this.readableRowCount;
	}
}

function viewOver(reader: FakeReader, changes: CsvDocumentChanges = new CsvDocumentChanges(), hasHeader = true): CsvRowView {
	return new CsvRowView(reader as unknown as CsvMappingReader, changes, () => hasHeader);
}

suite('CsvRowView', () => {
	test('displayedToPhysical accounts for the header row', () => {
		const withHeader = viewOver(new FakeReader([], configWith(), 0), new CsvDocumentChanges(), true);
		assert.strictEqual(withHeader.displayedToPhysical(0), 1);
		assert.strictEqual(withHeader.displayedToPhysical(4), 5);

		const noHeader = viewOver(new FakeReader([], configWith({ hasHeader: false }), 0), new CsvDocumentChanges(), false);
		assert.strictEqual(noHeader.displayedToPhysical(0), 0);
		assert.strictEqual(noHeader.displayedToPhysical(4), 4);
	});

	test('getBaseReadableRowCount excludes the header and clamps at zero', () => {
		assert.strictEqual(viewOver(new FakeReader([], configWith(), 5), new CsvDocumentChanges(), true).getBaseReadableRowCount(), 4);
		assert.strictEqual(viewOver(new FakeReader([], configWith({ hasHeader: false }), 5), new CsvDocumentChanges(), false).getBaseReadableRowCount(), 5);
		assert.strictEqual(viewOver(new FakeReader([], configWith(), 0), new CsvDocumentChanges(), true).getBaseReadableRowCount(), 0);
	});

	test('getDisplayedReadableRowCount adjusts base rows by pending inserts and deletes', () => {
		const reader = new FakeReader([], configWith(), 5); // base readable = 4

		const inserts = new CsvDocumentChanges();
		inserts.insertRow(0);
		inserts.insertRow(0);
		assert.strictEqual(viewOver(reader, inserts, true).getDisplayedReadableRowCount(), 6);

		const deletes = new CsvDocumentChanges();
		deletes.deleteRowRange(0, 3);
		assert.strictEqual(viewOver(reader, deletes, true).getDisplayedReadableRowCount(), 1);
	});

	test('displayedRowCountFor maps a raw header-inclusive count to displayed rows', () => {
		const changes = new CsvDocumentChanges();
		changes.insertRow(0);
		const view = viewOver(new FakeReader([], configWith(), 0), changes, true);
		assert.strictEqual(view.displayedRowCountFor(10), 10); // (10 - 1 header) + 1 insert
		assert.strictEqual(view.displayedRowCountFor(0), 1);    // max(0, 0 - 1) + 1 insert
	});

	test('readVirtualRows returns [] until the configuration is available', () => {
		const view = viewOver(new FakeReader(['h0,h1', 'a,b'], null, 2), new CsvDocumentChanges(), true);
		assert.deepStrictEqual(view.readVirtualRows(0, 1), []);
	});

	test('readVirtualRows reads header-offset physical rows and splits cells', () => {
		const reader = new FakeReader(['h0,h1', 'a,b', 'c,d', 'e,f'], configWith(), 4);
		const view = viewOver(reader, new CsvDocumentChanges(), true);
		assert.deepStrictEqual(view.readVirtualRows(0, 2), [['a', 'b'], ['c', 'd']]);
		assert.deepStrictEqual(reader.readRangeCalls, [[1, 2]]); // displayed 0 -> physical 1
	});

	test('readVirtualRows reflects cell edits over the base rows', () => {
		const reader = new FakeReader(['h0,h1', 'a,b', 'c,d'], configWith(), 3);
		const changes = new CsvDocumentChanges();
		changes.setCellContent(0, 1, 'EDIT'); // displayed row 0
		const view = viewOver(reader, changes, true);
		assert.deepStrictEqual(view.readVirtualRows(0, 2), [['a', 'EDIT'], ['c', 'd']]);
	});

	test('readDisplayedRows returns [] for an unreadable range and rows for a readable one', () => {
		const reader = new FakeReader(['h0,h1', 'a,b', 'c,d'], configWith(), 3); // base readable = 2
		const view = viewOver(reader, new CsvDocumentChanges(), true);
		assert.deepStrictEqual(view.readDisplayedRows(0, 5), []); // physical 1..5 exceeds readable
		assert.deepStrictEqual(view.readDisplayedRows(0, 2), [['a', 'b'], ['c', 'd']]);
	});

	test('canReadDisplayedRange rejects invalid ranges and accepts an empty range', () => {
		const view = viewOver(new FakeReader([], configWith(), 5), new CsvDocumentChanges(), true);
		assert.strictEqual(view.canReadDisplayedRange(-1, 1), false);
		assert.strictEqual(view.canReadDisplayedRange(0, -1), false);
		assert.strictEqual(view.canReadDisplayedRange(1.5, 1), false);
		assert.strictEqual(view.canReadDisplayedRange(0, 0), true);
	});

	test('canReadDisplayedRange defers to the reader with a header offset when there are no edits', () => {
		const reader = new FakeReader([], configWith(), 5); // physical rows 0..4 readable
		const view = viewOver(reader, new CsvDocumentChanges(), true);
		assert.strictEqual(view.canReadDisplayedRange(0, 4), true);  // physical 1..4 -> 5 <= 5
		assert.strictEqual(view.canReadDisplayedRange(0, 5), false); // physical 1..5 -> 6 > 5
		assert.deepStrictEqual(reader.canReadRangeCalls, [[1, 4], [1, 5]]);
	});

	test('canReadDisplayedRange treats inserted rows as readable and rejects starts past the end', () => {
		const reader = new FakeReader([], configWith(), 5); // base readable = 4
		const changes = new CsvDocumentChanges();
		changes.insertRow(0); // virtual: [inserted, base0..3], readable = 5
		const view = viewOver(reader, changes, true);
		assert.strictEqual(view.canReadDisplayedRange(0, 5), true);
		assert.strictEqual(view.canReadDisplayedRange(0, 6), true); // clamped to readable count
		assert.strictEqual(view.canReadDisplayedRange(5, 1), false); // offset >= readable
	});

	test('canReadDisplayedRange rejects a base segment the reader cannot serve once edits exist', () => {
		// Reader claims many readable rows but only serves physical ranges fully within [0, 5).
		const reader = new FakeReader([], configWith(), 100, (offset, count) => offset + count <= 5);
		const changes = new CsvDocumentChanges();
		changes.setCellContent(0, 0, 'x'); // makes hasChanges() true without changing counts
		const view = viewOver(reader, changes, true);
		assert.strictEqual(view.canReadDisplayedRange(0, 5), false); // physical 1..6 exceeds 5
		assert.strictEqual(view.canReadDisplayedRange(0, 4), true);  // physical 1..5 within 5
	});
});
