/// <reference types="mocha" />
import * as assert from 'assert';
import type { Memento } from 'vscode';
import type * as vscode from 'vscode';
import type { CsvDocument } from '../../CsvDocument';
import { UiPreferenceStore } from '../../preferences/UiPreferenceStore';
import type { DuckDbStatus } from '../../shared/messages/duckdb';
import { CsvLoadErrorReason } from '../../shared/messages/errors';
import { WebviewMessageRouter } from '../../webview/WebviewMessageRouter';

interface Recorded {
	method: string;
	args: unknown[];
}

/** Minimal in-memory Memento backed by a Map, so the router's preference store actually persists. */
class FakeMemento implements Memento {
	public readonly store = new Map<string, unknown>();
	public keys(): readonly string[] { return [...this.store.keys()]; }
	public get<T>(key: string): T | undefined;
	public get<T>(key: string, defaultValue: T): T;
	public get<T>(key: string, defaultValue?: T): T | undefined {
		return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
	}
	public update(key: string, value: unknown): Thenable<void> {
		if (value === undefined) { this.store.delete(key); } else { this.store.set(key, value); }
		return Promise.resolve();
	}
}

const DOCUMENT_URI = { fsPath: '/tmp/data.csv', toString: () => 'file:///tmp/data.csv' };
const DEFAULT_DUCKDB_STATUS: DuckDbStatus = { path: 'duckdb', exists: true, isExecutable: true, origin: 'default-path' };

function makeHarness(
	overrides: Partial<Record<string, (...args: unknown[]) => unknown>> = {},
	checkDuckDb: () => Promise<DuckDbStatus> = async () => DEFAULT_DUCKDB_STATUS
) {
	const calls: Recorded[] = [];
	const logs: string[] = [];
	const posted: unknown[] = [];

	const record = (method: string) => (...args: unknown[]) => {
		calls.push({ method, args });
		return overrides[method]?.(...args);
	};

	const document = {
		postReadyPageWhenAvailable: record('postReadyPageWhenAvailable'),
		postRowsIfAvailable: record('postRowsIfAvailable'),
		handleFindRequest: record('handleFindRequest'),
		setEditMode: record('setEditMode'),
		applySetCellContent: record('applySetCellContent'),
		applyInsertRow: record('applyInsertRow'),
		applyDeleteRowRange: record('applyDeleteRowRange'),
		applySetHeaderContent: record('applySetHeaderContent'),
		applyConfigChange: record('applyConfigChange'),
		postPage: record('postPage'),
		postExportCapabilities: record('postExportCapabilities'),
		uri: DOCUMENT_URI,
		// The export service only touches isIndexingFinal() on the not-final path exercised here.
		createExportHost: () => ({ isIndexingFinal: () => false })
	} as unknown as CsvDocument;

	const panel = {
		webview: { postMessage: (message: unknown) => { posted.push(message); return Promise.resolve(true); } }
	} as unknown as vscode.WebviewPanel;

	const preferences = new UiPreferenceStore(new FakeMemento(), new FakeMemento());
	const router = new WebviewMessageRouter(document, preferences, message => logs.push(message), checkDuckDb);
	return { router, panel, calls, logs, posted, preferences, uri: DOCUMENT_URI as unknown as vscode.Uri };
}

function methodsCalled(calls: Recorded[]): string[] {
	return calls.map(call => call.method);
}

suite('WebviewMessageRouter', () => {
	test('log messages are logged and not dispatched to the document', () => {
		const h = makeHarness();
		h.router.handle({ type: 'log', level: 'warn', message: 'boom', data: { x: 1 } }, h.panel);
		assert.deepStrictEqual(methodsCalled(h.calls), []);
		assert.match(h.logs[0], /Webview warn: boom \{"x":1\}/);
	});

	test('loaded-ready forwards offset/rowCount/panel', () => {
		const h = makeHarness();
		h.router.handle({ type: 'loaded-ready', offset: 5, rowCount: 20 }, h.panel);
		assert.deepStrictEqual(h.calls[0], { method: 'postReadyPageWhenAvailable', args: [5, 20, h.panel] });
	});

	test('loaded-ready also posts export capabilities', () => {
		const h = makeHarness();
		h.router.handle({ type: 'loaded-ready', offset: 0, rowCount: 10 }, h.panel);
		assert.ok(methodsCalled(h.calls).includes('postExportCapabilities'));
	});

	test('loaded-ready posts a rememberedState snapshot of stored preferences', async () => {
		const h = makeHarness();
		await h.preferences.setGlobal('theme', 'dark');
		await h.preferences.setForFile(h.uri, 'sep', ';');

		h.router.handle({ type: 'loaded-ready', offset: 0, rowCount: 10 }, h.panel);

		const snapshot = h.posted.find(message => (message as { type?: string }).type === 'rememberedState');
		assert.deepStrictEqual(snapshot, { type: 'rememberedState', global: { theme: 'dark' }, file: { sep: ';' } });
	});

	test('setMemory persists to the preference store in the requested scope', () => {
		const h = makeHarness();
		h.router.handle({ type: 'setMemory', scope: 'global', key: 'theme', value: 'dark' }, h.panel);
		h.router.handle({ type: 'setMemory', scope: 'file', key: 'sep', value: ';' }, h.panel);

		assert.deepStrictEqual(h.preferences.getGlobalSnapshot(), { theme: 'dark' });
		assert.deepStrictEqual(h.preferences.getFileSnapshot(h.uri), { sep: ';' });
	});

	test('checkDuckDb posts a duckDbStatus response', async () => {
		const status: DuckDbStatus = { path: '/opt/duckdb', exists: false, isExecutable: false, origin: 'settings' };
		const h = makeHarness({}, async () => status);

		h.router.handle({ type: 'checkDuckDb' }, h.panel);
		await Promise.resolve();

		assert.deepStrictEqual(h.posted.find(message => (message as { type?: string }).type === 'duckDbStatus'), { type: 'duckDbStatus', ...status });
		assert.ok(h.logs.some(line => /DuckDB status:/.test(line)));
	});

	test('exportRequest routes to the export service', () => {
		const h = makeHarness();
		h.router.handle({
			type: 'exportRequest', requestId: 'e1', format: 'json', destination: 'file',
			columns: [0], scope: 'all', retainAlignment: false, retainColors: false, columnStyles: [], formatOptions: {}
		}, h.panel);
		// The document is not finally indexed in this harness, so the service replies with an error.
		assert.ok(h.posted.some(message => (message as { type?: string }).type === 'exportError'));
	});

	test('requestRows forwards to postRowsIfAvailable', () => {
		const h = makeHarness();
		h.router.handle({ type: 'requestRows', requestId: 'r1', offset: 0, rowCount: 10, reason: 'viewport' }, h.panel);
		assert.deepStrictEqual(h.calls[0], { method: 'postRowsIfAvailable', args: ['r1', 0, 10, h.panel] });
	});

	test('requestRows failure posts an error message', () => {
		const h = makeHarness({ postRowsIfAvailable: () => { throw new Error('disk gone'); } });
		h.router.handle({ type: 'requestRows', requestId: 'r1', offset: 0, rowCount: 10, reason: 'viewport' }, h.panel);
		assert.deepStrictEqual(h.posted, [{ type: 'error', reason: CsvLoadErrorReason.Unknown }]);
		assert.ok(h.logs.some(line => /Failed to serve row request: disk gone/.test(line)));
	});

	test('findRequest forwards to handleFindRequest', () => {
		const h = makeHarness();
		const message = {
			type: 'findRequest',
			searchSessionId: 's1',
			action: 'next',
			query: 'q',
			options: { matchCase: false, wholeWord: false, regex: false },
			cursor: { rowIndex: 0, cellIndex: 0, charOffset: 0 },
			visibleRange: { startRowIndex: 0, endRowIndex: 1 }
		};
		h.router.handle(message, h.panel);
		assert.deepStrictEqual(h.calls[0], { method: 'handleFindRequest', args: [message, h.panel] });
	});

	test('edit-request messages forward to their apply methods', () => {
		const h = makeHarness();
		h.router.handle({ type: 'setEditMode', editable: true }, h.panel);
		h.router.handle({ type: 'setCellContent', requestId: 'c', rowIndex: 1, columnIndex: 2, value: 'v' }, h.panel);
		h.router.handle({ type: 'insertRow', requestId: 'i', rowIndex: 3 }, h.panel);
		h.router.handle({ type: 'deleteRowRange', requestId: 'd', offset: 4, count: 2 }, h.panel);
		h.router.handle({ type: 'setHeaderContent', requestId: 'hh', columnIndex: 0, value: 'h' }, h.panel);

		assert.deepStrictEqual(h.calls, [
			{ method: 'setEditMode', args: [true] },
			{ method: 'applySetCellContent', args: ['c', 1, 2, 'v', h.panel] },
			{ method: 'applyInsertRow', args: ['i', 3, h.panel] },
			{ method: 'applyDeleteRowRange', args: ['d', 4, 2, h.panel] },
			{ method: 'applySetHeaderContent', args: ['hh', 0, 'h', h.panel] }
		]);
	});

	test('setCsvConfig forwards to applyConfigChange', () => {
		const h = makeHarness();
		const message = { type: 'setCsvConfig', separator: ',', encoding: 'utf8', lineEnding: '\n', hasHeader: true };
		h.router.handle(message, h.panel);
		assert.deepStrictEqual(h.calls[0], { method: 'applyConfigChange', args: [message] });
	});

	test('requestPage forwards to postPage', () => {
		const h = makeHarness();
		h.router.handle({ type: 'requestPage', offset: 0, rowCount: 1000 }, h.panel);
		assert.deepStrictEqual(h.calls[0], { method: 'postPage', args: [0, 1000, h.panel] });
	});

	test('requestPage failure posts an error message', () => {
		const h = makeHarness({ postPage: () => { throw new Error('nope'); } });
		h.router.handle({ type: 'requestPage', offset: 0, rowCount: 1000 }, h.panel);
		assert.deepStrictEqual(h.posted, [{ type: 'error', reason: CsvLoadErrorReason.Unknown }]);
		assert.ok(h.logs.some(line => /Failed to serve page request: nope/.test(line)));
	});

	test('unknown messages are ignored and logged', () => {
		const h = makeHarness();
		h.router.handle({ type: 'mystery', payload: 1 }, h.panel);
		assert.deepStrictEqual(methodsCalled(h.calls), []);
		assert.deepStrictEqual(h.posted, []);
		assert.ok(h.logs.some(line => /Ignoring unknown webview message/.test(line)));
	});
});
