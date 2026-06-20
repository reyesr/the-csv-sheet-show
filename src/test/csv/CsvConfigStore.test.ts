/// <reference types="mocha" />
import * as assert from 'assert';
import type { Memento, Uri } from 'vscode';
import { CsvFileConfig, DecimalSeparator } from '../../csv/CsvFileConfig';
import { CsvConfigStore, extractHeaderRowKey } from '../../csv/CsvConfigStore';

/** Minimal in-memory Memento backed by a Map, plus a view of the keys actually written. */
class FakeMemento implements Memento {
	public readonly store = new Map<string, unknown>();

	public keys(): readonly string[] {
		return [...this.store.keys()];
	}

	public get<T>(key: string): T | undefined;
	public get<T>(key: string, defaultValue: T): T;
	public get<T>(key: string, defaultValue?: T): T | undefined {
		return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
	}

	public update(key: string, value: unknown): Thenable<void> {
		if (value === undefined) {
			this.store.delete(key);
		} else {
			this.store.set(key, value);
		}
		return Promise.resolve();
	}
}

/** A stand-in for vscode.Uri — the store only ever calls `toString()`. */
function fakeUri(value: string): Uri {
	return { toString: () => value } as unknown as Uri;
}

const CONFIG_A: CsvFileConfig = {
	separator: ';',
	encoding: 'latin1',
	lineEnding: '\r\n',
	decimalSeparator: DecimalSeparator.COMMAS,
	hasHeader: true
};

const CONFIG_B: CsvFileConfig = {
	separator: '\t',
	encoding: 'utf8',
	lineEnding: '\n',
	decimalSeparator: DecimalSeparator.DOT,
	hasHeader: false
};

suite('CsvConfigStore', () => {
	test('round-trips a per-file config keyed by URI', async () => {
		const memento = new FakeMemento();
		const store = new CsvConfigStore(memento);
		const uri = fakeUri('file:///a.csv');

		assert.strictEqual(store.getForFile(uri), undefined);

		await store.saveForFile(uri, CONFIG_A);

		assert.deepStrictEqual(store.getForFile(uri), CONFIG_A);
		assert.deepStrictEqual(memento.keys(), ['csv-config:file:file:///a.csv']);
	});

	test('per-file configs are isolated by URI', async () => {
		const store = new CsvConfigStore(new FakeMemento());

		await store.saveForFile(fakeUri('file:///a.csv'), CONFIG_A);

		assert.strictEqual(store.getForFile(fakeUri('file:///b.csv')), undefined);
	});

	test('round-trips a generalize config keyed by the raw header row', async () => {
		const memento = new FakeMemento();
		const store = new CsvConfigStore(memento);
		const headerRow = 'name;amount;date';

		assert.strictEqual(store.getForHeaders(headerRow), undefined);

		await store.saveForHeaders(headerRow, CONFIG_A);

		assert.deepStrictEqual(store.getForHeaders(headerRow), CONFIG_A);
		assert.deepStrictEqual(memento.keys(), [`csv-config:headers:${headerRow}`]);
	});

	test('header rows must match exactly', async () => {
		const store = new CsvConfigStore(new FakeMemento());

		await store.saveForHeaders('a,b', CONFIG_A);

		assert.strictEqual(store.getForHeaders('a,c'), undefined);
		assert.strictEqual(store.getForHeaders('a;b'), undefined);
		assert.deepStrictEqual(store.getForHeaders('a,b'), CONFIG_A);
	});

	test('file and header namespaces do not collide', async () => {
		const store = new CsvConfigStore(new FakeMemento());
		const uri = fakeUri('name');

		await store.saveForFile(uri, CONFIG_A);
		await store.saveForHeaders('name', CONFIG_B);

		assert.deepStrictEqual(store.getForFile(uri), CONFIG_A);
		assert.deepStrictEqual(store.getForHeaders('name'), CONFIG_B);
	});
});

suite('extractHeaderRowKey', () => {
	test('returns the bytes before a LF line ending', () => {
		assert.strictEqual(extractHeaderRowKey(Buffer.from('name,amount\nalpha,1', 'utf8')), 'name,amount');
	});

	test('stops at the CR of a CRLF line ending (excludes the CR)', () => {
		assert.strictEqual(extractHeaderRowKey(Buffer.from('name,amount\r\nalpha,1', 'utf8')), 'name,amount');
	});

	test('returns the bytes before a CR-only line ending', () => {
		assert.strictEqual(extractHeaderRowKey(Buffer.from('name,amount\ralpha,1', 'utf8')), 'name,amount');
	});

	test('returns undefined when the chunk has no line ending', () => {
		assert.strictEqual(extractHeaderRowKey(Buffer.from('name,amount', 'utf8')), undefined);
	});

	test('returns undefined for an empty buffer', () => {
		assert.strictEqual(extractHeaderRowKey(Buffer.alloc(0)), undefined);
	});

	test('returns an empty string when the first byte is a line ending', () => {
		assert.strictEqual(extractHeaderRowKey(Buffer.from('\nrow', 'utf8')), '');
	});

	test('derives the same key for files that share a header line but differ below', () => {
		const original = Buffer.from('name,amount\nalpha,1', 'utf8');
		const similar = Buffer.from('name,amount\nbeta,2\ngamma,3', 'utf8');

		assert.strictEqual(extractHeaderRowKey(original), extractHeaderRowKey(similar));
	});
});
