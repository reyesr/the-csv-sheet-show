/// <reference types="mocha" />
import * as assert from 'assert';
import type * as vscode from 'vscode';
import { ActivePanelTracker } from '../../webview/ActivePanelTracker';

interface FakePanel {
	panel: vscode.WebviewPanel;
	posted: unknown[];
	fireViewState(active: boolean): void;
	fireDispose(): void;
}

function makePanel(): FakePanel {
	const posted: unknown[] = [];
	let viewStateCb: ((event: { webviewPanel: vscode.WebviewPanel }) => void) | undefined;
	let disposeCb: (() => void) | undefined;

	const panel = {
		active: false,
		webview: {
			postMessage: (message: unknown) => { posted.push(message); return Promise.resolve(true); }
		},
		onDidChangeViewState: (cb: (event: { webviewPanel: vscode.WebviewPanel }) => void) => {
			viewStateCb = cb;
			return { dispose() { /* noop */ } };
		},
		onDidDispose: (cb: () => void) => {
			disposeCb = cb;
			return { dispose() { /* noop */ } };
		}
	} as unknown as vscode.WebviewPanel;

	return {
		panel,
		posted,
		fireViewState: (active: boolean) => {
			(panel as unknown as { active: boolean }).active = active;
			viewStateCb?.({ webviewPanel: panel });
		},
		fireDispose: () => disposeCb?.()
	};
}

suite('ActivePanelTracker', () => {
	test('posts to the tracked panel', () => {
		const tracker = new ActivePanelTracker();
		const a = makePanel();
		tracker.track(a.panel);

		tracker.post({ type: 'showFind' });
		assert.deepStrictEqual(a.posted, [{ type: 'showFind' }]);
	});

	test('follows focus to the most recently activated panel', () => {
		const tracker = new ActivePanelTracker();
		const a = makePanel();
		const b = makePanel();
		tracker.track(a.panel);
		tracker.track(b.panel);

		// `a` regains focus -> messages route to it.
		a.fireViewState(true);
		tracker.post({ type: 'findNext' });
		assert.deepStrictEqual(a.posted, [{ type: 'findNext' }]);
		assert.deepStrictEqual(b.posted, []);

		// A view-state change with active=false must not steal focus.
		b.fireViewState(false);
		tracker.post({ type: 'findPrevious' });
		assert.deepStrictEqual(a.posted, [{ type: 'findNext' }, { type: 'findPrevious' }]);
	});

	test('clears the active panel when it is disposed', () => {
		const tracker = new ActivePanelTracker();
		const a = makePanel();
		tracker.track(a.panel);

		a.fireDispose();
		tracker.post({ type: 'closeFind' });
		assert.deepStrictEqual(a.posted, []);
	});

	test('post is a no-op when no panel is tracked', () => {
		const tracker = new ActivePanelTracker();
		assert.doesNotThrow(() => tracker.post({ type: 'showFind' }));
	});
});
