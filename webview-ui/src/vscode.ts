import type { WebviewToExtensionMessage } from '../../src/shared/messages/protocol';

interface VsCodeApi {
	postMessage(message: WebviewToExtensionMessage): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

export function postMessage(message: WebviewToExtensionMessage): void {
	vscode.postMessage(message);
}

/**
 * Shape of the blob VS Code persists for this webview. Components stash small bits of UI
 * preference under `metadata`, namespaced by key, so unrelated state survives a write.
 */
interface WebviewState {
	metadata?: Record<string, unknown>;
}

function readState(): WebviewState {
	const state = vscode.getState();
	return state !== null && typeof state === 'object' ? (state as WebviewState) : {};
}

/**
 * Read a value previously stored with {@link setWorkspaceMetadata}, keyed by `key`. Returns
 * `undefined` when nothing is stored. Backed by VS Code's webview state, which the workspace
 * persists across reloads.
 */
export function getWorkspaceMetadata<T>(key: string): T | undefined {
	return readState().metadata?.[key] as T | undefined;
}

/** Persist `value` under `key` in the workspace-backed webview metadata store. */
export function setWorkspaceMetadata<T>(key: string, value: T): void {
	const state = readState();
	vscode.setState({ ...state, metadata: { ...state.metadata, [key]: value } });
}

/**
 * A get/set pair over the workspace metadata store for a SplitButton's remembered default,
 * namespaced by `id`. Centralizes the `splitButtonDefault:` key so call sites avoid magic strings.
 */
export function splitButtonDefaultStore(id: string): {
	get: () => string | undefined;
	set: (value: string) => void;
} {
	const key = `splitButtonDefault:${id}`;
	return {
		get: () => getWorkspaceMetadata<string>(key),
		set: value => setWorkspaceMetadata(key, value),
	};
}
