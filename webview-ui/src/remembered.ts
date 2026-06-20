import type { Accessor } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { RememberScope, RememberedStateMessage, SetMemoryMessage } from '../../src/shared/messages/memory';
import { postMessage } from './vscode';

export type { RememberScope };

/**
 * Reactive cache of remembered values for this session, flattened to `${scope}:${key}` entries and
 * seeded once by the extension's `rememberedState` snapshot (see {@link applyRememberedSnapshot}).
 * Reads are synchronous so controlled components have a value at mount, and reactive so they update
 * the instant the snapshot lands — Solid tracks the still-absent key until it arrives.
 */
const [cache, setCache] = createStore<Record<string, unknown>>({});

const cacheKey = (scope: RememberScope, key: string): string => `${scope}:${key}`;

/** Seed the cache from the extension's snapshot. Called by the message bridge on `rememberedState`. */
export function applyRememberedSnapshot(message: RememberedStateMessage): void {
	const seed: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(message.global)) {
		seed[cacheKey('global', key)] = value;
	}
	for (const [key, value] of Object.entries(message.file)) {
		seed[cacheKey('file', key)] = value;
	}
	setCache(seed);
}

/**
 * A persistent, reactive signal for a single remembered choice — the webview-side counterpart to
 * VS Code's `Memento`. `value()` returns the remembered value; `set(v)` records it locally and asks
 * the extension to persist it in the chosen `scope` (`'global'` workspace-wide, or `'file'` for the
 * current file). Wire it to any controlled control:
 *
 * @example
 * const choice = createRememberedSignal('format.savingOption', { scope: 'file', default: 'remember' });
 * <Select selectedValue={choice.value()} onSelect={choice.set} options={...} />
 *
 * With a `default`, `value()` returns it until a choice is stored. Omit `default` to get `T | undefined`
 * instead — handy when the resting value comes from elsewhere (e.g. a detected config you fall back to
 * until the user pins an override).
 *
 * Storage is owned by the extension and seeded asynchronously at load, so `value()` briefly returns
 * the default (or `undefined`) until the snapshot arrives, then reactively updates to the stored value.
 */
export function createRememberedSignal<T>(
	key: string,
	options: { scope: RememberScope; default: T }
): { value: Accessor<T>; set: (value: T) => void };
export function createRememberedSignal<T>(
	key: string,
	options: { scope: RememberScope }
): { value: Accessor<T | undefined>; set: (value: T) => void };
export function createRememberedSignal<T>(
	key: string,
	options: { scope: RememberScope; default?: T }
): { value: Accessor<T | undefined>; set: (value: T) => void } {
	const composite = cacheKey(options.scope, key);

	const value: Accessor<T | undefined> = () => {
		const stored = cache[composite];
		return stored !== undefined ? (stored as T) : options.default;
	};

	const set = (next: T): void => {
		// A Solid store `set` MERGES object values (keys absent from `next` are retained), so a stored
		// map can never drop a key by passing a replacement object — which broke "reset to default" for
		// per-column options/widths. reconcile does a true diff (including removals) while keeping
		// fine-grained reactivity. Primitives already replace correctly (and reconcile rejects non-objects).
		setCache(composite, typeof next === 'object' && next !== null ? reconcile(next) : (next as unknown));
		const message: SetMemoryMessage = { type: 'setMemory', scope: options.scope, key, value: next };
		postMessage(message);
	};

	return { value, set };
}
