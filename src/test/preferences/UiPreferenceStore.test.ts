/// <reference types="mocha" />
import * as assert from 'assert';
import type { Memento, Uri } from 'vscode';
import { UiPreferenceStore } from '../../preferences/UiPreferenceStore';

/** Minimal in-memory Memento backed by a Map (mirrors the CsvConfigStore test helper). */
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

function makeStore(): { store: UiPreferenceStore; globalMemento: FakeMemento; workspaceMemento: FakeMemento } {
	const globalMemento = new FakeMemento();
	const workspaceMemento = new FakeMemento();
	return { store: new UiPreferenceStore(globalMemento, workspaceMemento), globalMemento, workspaceMemento };
}

suite('UiPreferenceStore', () => {
	test('round-trips a global value and exposes it in the snapshot under the bare key', async () => {
		const { store, globalMemento } = makeStore();

		assert.deepStrictEqual(store.getGlobalSnapshot(), {});

		await store.setGlobal('theme', 'dark');

		assert.deepStrictEqual(store.getGlobalSnapshot(), { theme: 'dark' });
		assert.deepStrictEqual(globalMemento.keys(), ['mem:global:theme']);
	});

	test('round-trips a per-file value keyed by URI', async () => {
		const { store, workspaceMemento } = makeStore();
		const uri = fakeUri('file:///a.csv');

		await store.setForFile(uri, 'sep', ';');

		assert.deepStrictEqual(store.getFileSnapshot(uri), { sep: ';' });
		assert.deepStrictEqual(workspaceMemento.keys(), ['mem:file:file:///a.csv:sep']);
	});

	test('per-file values are isolated by URI', async () => {
		const { store } = makeStore();

		await store.setForFile(fakeUri('file:///a.csv'), 'sep', ';');

		assert.deepStrictEqual(store.getFileSnapshot(fakeUri('file:///b.csv')), {});
	});

	test('global and per-file namespaces do not collide for the same key', async () => {
		const { store } = makeStore();
		const uri = fakeUri('file:///a.csv');

		await store.setGlobal('mode', 'wide');
		await store.setForFile(uri, 'mode', 'narrow');

		assert.deepStrictEqual(store.getGlobalSnapshot(), { mode: 'wide' });
		assert.deepStrictEqual(store.getFileSnapshot(uri), { mode: 'narrow' });
	});

	test('snapshots gather multiple keys and survive a value being cleared', async () => {
		const { store } = makeStore();

		await store.setGlobal('a', 1);
		await store.setGlobal('b', 2);
		assert.deepStrictEqual(store.getGlobalSnapshot(), { a: 1, b: 2 });

		await store.setGlobal('a', undefined);
		assert.deepStrictEqual(store.getGlobalSnapshot(), { b: 2 });
	});
});
