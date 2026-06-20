/// <reference types="mocha" />
import * as assert from 'assert';
import type * as vscode from 'vscode';
import { CsvDocumentChanges } from '../CsvDocumentChanges';
import { CsvEditController, type EditHost } from '../CsvEditController';
import type { CsvRowView } from '../CsvRowView';

const PANEL = {} as unknown as vscode.WebviewPanel;

function makeFixture(rowCount = 5) {
	const changes = new CsvDocumentChanges();
	const rowView = { getDisplayedReadableRowCount: () => rowCount } as unknown as CsvRowView;

	const posted: Array<Record<string, unknown>> = [];
	const edits: Array<{ label: string }> = [];
	const counts = { clearPageCaches: 0, broadcastStatistics: 0, refreshHeaders: 0 };
	const state = { indexingFinal: true, canEditHeader: true };

	const host: EditHost = {
		post: message => posted.push(message as unknown as Record<string, unknown>),
		clearPageCaches: () => { counts.clearPageCaches++; },
		broadcastStatistics: () => { counts.broadcastStatistics++; },
		refreshHeaders: () => { counts.refreshHeaders++; },
		isIndexingFinal: () => state.indexingFinal,
		canEditHeader: () => state.canEditHeader,
		log: () => { /* swallow */ }
	};

	const controller = new CsvEditController(changes, rowView, host);
	controller.onDidEdit(event => edits.push(event));
	return { changes, controller, posted, edits, counts, state };
}

function lastPost(posted: Array<Record<string, unknown>>): Record<string, unknown> {
	return posted[posted.length - 1];
}

suite('CsvEditController', () => {
	test('rejects edits while read-only', () => {
		const f = makeFixture();
		f.controller.applySetCellContent('r1', 0, 0, 'x', PANEL);

		assert.deepStrictEqual(lastPost(f.posted), { type: 'changeRejected', requestId: 'r1', reason: 'Document is read-only' });
		assert.strictEqual(f.changes.hasChanges(), false);
		assert.deepStrictEqual(f.edits, []);
	});

	test('setEditMode enables only when indexing is final and echoes the state', () => {
		const f = makeFixture();

		f.state.indexingFinal = false;
		f.controller.setEditMode(true);
		assert.strictEqual(f.controller.isEditMode(), false);
		assert.deepStrictEqual(lastPost(f.posted), { type: 'editMode', isEditable: false });

		f.state.indexingFinal = true;
		f.controller.setEditMode(true);
		assert.strictEqual(f.controller.isEditMode(), true);
		assert.deepStrictEqual(lastPost(f.posted), { type: 'editMode', isEditable: true });
	});

	test('applies a valid cell edit with side effects', () => {
		const f = makeFixture();
		f.controller.setEditMode(true);
		f.controller.applySetCellContent('r1', 2, 0, 'edited', PANEL);

		assert.strictEqual(f.changes.hasChanges(), true);
		assert.strictEqual(f.counts.clearPageCaches, 1);
		assert.strictEqual(f.counts.broadcastStatistics, 1);
		assert.deepStrictEqual(f.edits, [{ label: 'Edit cell' }]);
		const post = lastPost(f.posted);
		assert.strictEqual(post.type, 'changeApplied');
		assert.strictEqual(post.requestId, 'r1');
		assert.deepStrictEqual(post.invalidatedRange, { startRowIndex: 2, endRowIndex: 2 });
	});

	test('rejects out-of-range cell edits without mutating the log', () => {
		const f = makeFixture(5);
		f.controller.setEditMode(true);
		f.controller.applySetCellContent('r1', 5, 0, 'x', PANEL); // rowIndex == rowCount is out of range

		assert.deepStrictEqual(lastPost(f.posted), { type: 'changeRejected', requestId: 'r1', reason: 'Target cell is out of range' });
		assert.strictEqual(f.changes.hasChanges(), false);
	});

	test('insertRow accepts the append boundary but rejects beyond it', () => {
		const f = makeFixture(5);
		f.controller.setEditMode(true);

		f.controller.applyInsertRow('ok', 5, PANEL); // append at end is allowed
		assert.strictEqual(lastPost(f.posted).type, 'changeApplied');

		f.controller.applyInsertRow('bad', 6, PANEL);
		assert.deepStrictEqual(lastPost(f.posted), { type: 'changeRejected', requestId: 'bad', reason: 'Insertion point is out of range' });
	});

	test('header edits require an editable header row', () => {
		const f = makeFixture();
		f.controller.setEditMode(true);

		f.state.canEditHeader = false;
		f.controller.applySetHeaderContent('h1', 0, 'Name', PANEL);
		assert.deepStrictEqual(lastPost(f.posted), { type: 'changeRejected', requestId: 'h1', reason: 'This file has no header row to edit' });

		f.state.canEditHeader = true;
		f.controller.applySetHeaderContent('h2', 0, 'Name', PANEL);
		assert.strictEqual(f.counts.refreshHeaders, 1);
		assert.deepStrictEqual(f.edits[f.edits.length - 1], { label: 'Edit header' });
		const post = lastPost(f.posted);
		assert.strictEqual(post.type, 'changeApplied');
		assert.deepStrictEqual(post.invalidatedRange, { startRowIndex: 0, endRowIndex: -1 });
	});

	test('addHeaderRow creates an inserted header on a header-less file', () => {
		const f = makeFixture();
		f.controller.setEditMode(true);
		f.state.canEditHeader = false; // header-less file

		f.controller.applyAddHeaderRow('a1', 3, PANEL);

		assert.strictEqual(f.changes.hasInsertedHeader(), true);
		assert.deepStrictEqual(f.changes.getInsertedHeaderCells(), ['', '', '']);
		assert.deepStrictEqual(f.edits[f.edits.length - 1], { label: 'Add header row' });
		const post = lastPost(f.posted);
		assert.strictEqual(post.type, 'changeApplied');
		assert.strictEqual(post.requestId, 'a1');
		assert.deepStrictEqual(post.invalidatedRange, { startRowIndex: 0, endRowIndex: -1 });
	});

	test('addHeaderRow is rejected when a header already exists', () => {
		const f = makeFixture();
		f.controller.setEditMode(true);
		f.state.canEditHeader = true; // already headed

		f.controller.applyAddHeaderRow('a1', 3, PANEL);

		assert.deepStrictEqual(lastPost(f.posted), { type: 'changeRejected', requestId: 'a1', reason: 'This file already has a header row' });
		assert.strictEqual(f.changes.hasInsertedHeader(), false);
	});

	test('a column can be named right after the header is added', () => {
		const f = makeFixture();
		f.controller.setEditMode(true);
		f.state.canEditHeader = false;

		f.controller.applyAddHeaderRow('a1', 3, PANEL);
		f.state.canEditHeader = true; // the document now reports an editable (inserted) header
		f.controller.applySetHeaderContent('h1', 1, 'Hello', PANEL);

		assert.deepStrictEqual(f.changes.getInsertedHeaderCells(), ['', 'Hello', '']);
	});

	test('undoing an added header refreshes the header and clears it', () => {
		const f = makeFixture();
		f.controller.setEditMode(true);
		f.state.canEditHeader = false;
		f.controller.applyAddHeaderRow('a1', 3, PANEL);

		const before = f.counts.refreshHeaders;
		f.controller.undoEdit();

		assert.strictEqual(f.changes.hasInsertedHeader(), false);
		assert.strictEqual(f.counts.refreshHeaders, before + 1);
	});

	test('undo reverts the last change and broadcasts', () => {
		const f = makeFixture();
		f.controller.setEditMode(true);
		f.controller.applySetCellContent('r1', 1, 0, 'v', PANEL);
		assert.strictEqual(f.controller.canUndo(), true);

		f.controller.undoEdit();
		assert.strictEqual(f.changes.hasChanges(), false);
		assert.strictEqual(f.controller.canRedo(), true);
		assert.strictEqual(lastPost(f.posted).type, 'changeApplied');
	});

	test('restoreEditable seeds the editable flag from a backup', () => {
		const f = makeFixture();
		assert.strictEqual(f.controller.isEditMode(), false);
		f.controller.restoreEditable(true);
		assert.strictEqual(f.controller.isEditMode(), true);
	});
});
