/// <reference types="mocha" />
import * as assert from 'assert';
import { CsvDocumentChanges } from '../CsvDocumentChanges';

function baseReaderOver(rows: string[][]): (baseStart: number, length: number) => string[][] {
	return (baseStart, length) => rows.slice(baseStart, baseStart + length).map(row => row.slice());
}

const SAMPLE: string[][] = Array.from({ length: 10 }, (_, index) => [`r${index}c0`, `r${index}c1`]);

suite('CsvDocumentChanges', () => {
	test('passes rows through unchanged when there are no changes', () => {
		const changes = new CsvDocumentChanges();
		assert.strictEqual(changes.hasChanges(), false);
		assert.deepStrictEqual(changes.readRows(2, 3, baseReaderOver(SAMPLE)), [
			['r2c0', 'r2c1'],
			['r3c0', 'r3c1'],
			['r4c0', 'r4c1']
		]);
	});

	test('set-cell-content overlays a single cell without touching others', () => {
		const changes = new CsvDocumentChanges();
		changes.setCellContent(3, 1, 'edited');
		const rows = changes.readRows(2, 3, baseReaderOver(SAMPLE));
		assert.deepStrictEqual(rows, [
			['r2c0', 'r2c1'],
			['r3c0', 'edited'],
			['r4c0', 'r4c1']
		]);
	});

	test('set-cell-content extends the row with empty cells up to the column', () => {
		const changes = new CsvDocumentChanges();
		changes.setCellContent(0, 4, 'far');
		assert.deepStrictEqual(changes.readRows(0, 1, baseReaderOver(SAMPLE)), [
			['r0c0', 'r0c1', '', '', 'far']
		]);
	});

	test('insert-row inserts an empty row and shifts following rows down', () => {
		const changes = new CsvDocumentChanges();
		changes.insertRow(1);
		assert.strictEqual(changes.getRowCountDelta(), 1);
		const rows = changes.readRows(0, 4, baseReaderOver(SAMPLE));
		assert.deepStrictEqual(rows, [
			['r0c0', 'r0c1'],
			[],
			['r1c0', 'r1c1'],
			['r2c0', 'r2c1']
		]);
	});

	test('virtual-index model: set-cell after insert targets the inserted row', () => {
		const changes = new CsvDocumentChanges();
		changes.insertRow(5);
		changes.setCellContent(5, 0, 'in-new-row');
		const rows = changes.readRows(4, 3, baseReaderOver(SAMPLE));
		assert.deepStrictEqual(rows, [
			['r4c0', 'r4c1'],
			['in-new-row'],
			['r5c0', 'r5c1']
		]);
	});

	test('cell edits on base rows survive later structural shifts', () => {
		const changes = new CsvDocumentChanges();
		changes.setCellContent(5, 0, 'sticky');
		changes.insertRow(0);
		// The originally-5th data row is now at virtual index 6, still carrying its edit.
		const rows = changes.readRows(6, 1, baseReaderOver(SAMPLE));
		assert.deepStrictEqual(rows, [['sticky', 'r5c1']]);
	});

	test('delete-row-range removes rows and adjusts the count', () => {
		const changes = new CsvDocumentChanges();
		changes.deleteRowRange(2, 3);
		assert.strictEqual(changes.getRowCountDelta(), -3);
		const rows = changes.readRows(0, 4, baseReaderOver(SAMPLE));
		assert.deepStrictEqual(rows, [
			['r0c0', 'r0c1'],
			['r1c0', 'r1c1'],
			['r5c0', 'r5c1'],
			['r6c0', 'r6c1']
		]);
	});

	test('interleaved insert and delete resolve to the correct virtual view', () => {
		const changes = new CsvDocumentChanges();
		changes.insertRow(3);          // empty row at virtual 3
		changes.deleteRowRange(0, 2);  // drop original rows 0 and 1
		// virtual: [r2, <inserted>, r3, r4, ...]
		const rows = changes.readRows(0, 4, baseReaderOver(SAMPLE));
		assert.deepStrictEqual(rows, [
			['r2c0', 'r2c1'],
			[],
			['r3c0', 'r3c1'],
			['r4c0', 'r4c1']
		]);
	});

	test('undo reverts the last change; redo re-applies it', () => {
		const changes = new CsvDocumentChanges();
		changes.setCellContent(0, 0, 'v1');
		changes.deleteRowRange(2, 1);
		assert.strictEqual(changes.getRowCountDelta(), -1);

		const undone = changes.undo();
		assert.strictEqual(undone?.change.type, 'delete-row-range');
		assert.strictEqual(changes.getRowCountDelta(), 0);
		assert.deepStrictEqual(changes.readRows(0, 3, baseReaderOver(SAMPLE)), [
			['v1', 'r0c1'],
			['r1c0', 'r1c1'],
			['r2c0', 'r2c1']
		]);

		const redone = changes.redo();
		assert.strictEqual(redone?.change.type, 'delete-row-range');
		assert.strictEqual(changes.getRowCountDelta(), -1);
		assert.deepStrictEqual(changes.readRows(2, 1, baseReaderOver(SAMPLE)), [['r3c0', 'r3c1']]);
	});

	test('a new change after undo clears the redo stack', () => {
		const changes = new CsvDocumentChanges();
		changes.setCellContent(0, 0, 'a');
		changes.undo();
		assert.strictEqual(changes.canRedo(), true);
		changes.setCellContent(1, 0, 'b');
		assert.strictEqual(changes.canRedo(), false);
		assert.strictEqual(changes.redo(), null);
	});

	test('overwriting a cell then undoing restores the previous edited value', () => {
		const changes = new CsvDocumentChanges();
		changes.setCellContent(0, 0, 'first');
		changes.setCellContent(0, 0, 'second');
		assert.deepStrictEqual(changes.readRows(0, 1, baseReaderOver(SAMPLE)), [['second', 'r0c1']]);
		changes.undo();
		assert.deepStrictEqual(changes.readRows(0, 1, baseReaderOver(SAMPLE)), [['first', 'r0c1']]);
	});

	test('serialize/restore reproduces an identical virtual view', () => {
		const changes = new CsvDocumentChanges();
		changes.insertRow(2);
		changes.setCellContent(2, 0, 'inserted');
		changes.setCellContent(5, 1, 'base-edit');
		changes.deleteRowRange(7, 1);
		const before = changes.readRows(0, 9, baseReaderOver(SAMPLE));

		const restored = new CsvDocumentChanges();
		restored.restore(changes.serialize());
		const after = restored.readRows(0, 9, baseReaderOver(SAMPLE));

		assert.deepStrictEqual(after, before);
		assert.strictEqual(restored.getRowCountDelta(), changes.getRowCountDelta());
	});

	test('set-header-content overlays header cells and survives serialize/restore and undo', () => {
		const changes = new CsvDocumentChanges();
		assert.strictEqual(changes.hasHeaderEdits(), false);
		changes.setHeaderContent(1, 'Renamed');
		assert.strictEqual(changes.hasHeaderEdits(), true);
		assert.deepStrictEqual(changes.decorateHeader(['A', 'B', 'C']), ['A', 'Renamed', 'C']);
		// Data rows are unaffected by a header edit.
		assert.deepStrictEqual(changes.readRows(0, 1, baseReaderOver(SAMPLE)), [['r0c0', 'r0c1']]);

		const restored = new CsvDocumentChanges();
		restored.restore(changes.serialize());
		assert.deepStrictEqual(restored.decorateHeader(['A', 'B', 'C']), ['A', 'Renamed', 'C']);

		changes.undo();
		assert.strictEqual(changes.hasHeaderEdits(), false);
		assert.deepStrictEqual(changes.decorateHeader(['A', 'B', 'C']), ['A', 'B', 'C']);
	});

	test('set-header-content extends the header with empty cells up to the column', () => {
		const changes = new CsvDocumentChanges();
		changes.setHeaderContent(3, 'Far');
		assert.deepStrictEqual(changes.decorateHeader(['A', 'B']), ['A', 'B', '', 'Far']);
	});

	test('insert-header creates an editable header of empty cells', () => {
		const changes = new CsvDocumentChanges();
		assert.strictEqual(changes.hasInsertedHeader(), false);
		assert.strictEqual(changes.getInsertedHeaderCells(), null);

		changes.insertHeader(['', '', '']);
		assert.strictEqual(changes.hasInsertedHeader(), true);
		assert.deepStrictEqual(changes.getInsertedHeaderCells(), ['', '', '']);
		// An inserted header is not a data row: the virtual view is unchanged.
		assert.strictEqual(changes.getRowCountDelta(), 0);
		assert.deepStrictEqual(changes.readRows(0, 1, baseReaderOver(SAMPLE)), [['r0c0', 'r0c1']]);
	});

	test('header edits overlay the inserted header, preserving empties', () => {
		const changes = new CsvDocumentChanges();
		changes.insertHeader(['', '', '']);
		changes.setHeaderContent(1, 'Hello');
		assert.deepStrictEqual(changes.getInsertedHeaderCells(), ['', 'Hello', '']);
	});

	test('undo removes an inserted header; remove-header clears it too', () => {
		const changes = new CsvDocumentChanges();
		changes.insertHeader(['', '']);
		changes.undo();
		assert.strictEqual(changes.hasInsertedHeader(), false);
		assert.strictEqual(changes.getInsertedHeaderCells(), null);

		changes.insertHeader(['', '']);
		changes.removeHeader();
		assert.strictEqual(changes.hasInsertedHeader(), false);
	});

	test('serialize/restore round-trips an inserted header with edits', () => {
		const changes = new CsvDocumentChanges();
		changes.insertHeader(['', '', '']);
		changes.setHeaderContent(0, 'id');

		const restored = new CsvDocumentChanges();
		restored.restore(changes.serialize());
		assert.strictEqual(restored.hasInsertedHeader(), true);
		assert.deepStrictEqual(restored.getInsertedHeaderCells(), ['id', '', '']);
	});

	test('clear drops all changes and returns to passthrough', () => {
		const changes = new CsvDocumentChanges();
		changes.insertRow(0);
		changes.setCellContent(3, 0, 'x');
		changes.clear();
		assert.strictEqual(changes.hasChanges(), false);
		assert.strictEqual(changes.getRowCountDelta(), 0);
		assert.deepStrictEqual(changes.readRows(0, 2, baseReaderOver(SAMPLE)), [
			['r0c0', 'r0c1'],
			['r1c0', 'r1c1']
		]);
	});
});
