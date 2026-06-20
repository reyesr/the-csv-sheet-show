import type { Memento, Uri } from 'vscode';

const GLOBAL_KEY_PREFIX = 'mem:global:';
const FILE_KEY_PREFIX = 'mem:file:';

/**
 * Durable storage for remembered UI selections, split across two VS Code `Memento`s:
 * - **global** (workspace-wide) values live in `globalState`, keyed `mem:global:${key}`;
 * - **per-file** values live in `workspaceState`, keyed `mem:file:${uri}:${key}` so each file's
 *   choices stay isolated.
 *
 * The snapshot getters strip the prefix so the webview sees the same bare `key` it stored under.
 * Only the `Memento`/`Uri` types are imported, so this stays decoupled from the VS Code runtime and
 * unit-tests with a fake `Memento` — mirroring {@link CsvConfigStore}.
 */
export class UiPreferenceStore {
	public constructor(
		private readonly globalMemento: Memento,
		private readonly workspaceMemento: Memento
	) { }

	public setGlobal(key: string, value: unknown): Thenable<void> {
		return this.globalMemento.update(globalKey(key), value);
	}

	public setForFile(uri: Uri, key: string, value: unknown): Thenable<void> {
		return this.workspaceMemento.update(fileKey(uri, key), value);
	}

	/** Every global entry, keyed by its bare `key` (prefix stripped). */
	public getGlobalSnapshot(): Record<string, unknown> {
		return collect(this.globalMemento, GLOBAL_KEY_PREFIX);
	}

	/** This file's entries only, keyed by their bare `key` (prefix stripped). */
	public getFileSnapshot(uri: Uri): Record<string, unknown> {
		return collect(this.workspaceMemento, `${FILE_KEY_PREFIX}${uri.toString()}:`);
	}
}

function collect(memento: Memento, prefix: string): Record<string, unknown> {
	const snapshot: Record<string, unknown> = {};
	for (const storedKey of memento.keys()) {
		if (storedKey.startsWith(prefix)) {
			snapshot[storedKey.slice(prefix.length)] = memento.get(storedKey);
		}
	}
	return snapshot;
}

function globalKey(key: string): string {
	return `${GLOBAL_KEY_PREFIX}${key}`;
}

function fileKey(uri: Uri, key: string): string {
	return `${FILE_KEY_PREFIX}${uri.toString()}:${key}`;
}
