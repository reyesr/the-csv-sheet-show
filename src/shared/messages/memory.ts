/**
 * Messages for the "remembered UI selections" mechanism. A control in the webview persists the
 * user's last choice under a stable `key`, scoped either globally (workspace-wide) or to the current
 * file. The extension host owns durability (`globalState` / `workspaceState` keyed by the document
 * URI); the webview keeps a synchronous in-memory cache, seeded once at load by a
 * {@link RememberedStateMessage}.
 */

/** Where a remembered value lives: shared across the workspace, or tied to the current file. */
export type RememberScope = 'global' | 'file';

/**
 * webview → extension: persist `value` under `key` in the given `scope`. Fire-and-forget — the next
 * load's {@link RememberedStateMessage} reflects it. `value` must be JSON-serializable.
 */
export interface SetMemoryMessage {
	type: 'setMemory';
	scope: RememberScope;
	key: string;
	value: unknown;
}

/**
 * extension → webview: the full set of remembered values, sent once in response to `loaded-ready`.
 * `file` carries only the current file's entries (no cross-file leakage); `global` is workspace-wide.
 * Both are keyed by the same bare `key` the webview stored under.
 */
export interface RememberedStateMessage {
	type: 'rememberedState';
	global: Record<string, unknown>;
	file: Record<string, unknown>;
}
