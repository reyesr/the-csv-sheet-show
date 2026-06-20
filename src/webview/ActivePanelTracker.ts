import type * as vscode from 'vscode';
import type { ExtensionToWebviewMessage } from '../shared/messages/protocol';

/**
 * Tracks which webview panel currently has focus so editor-wide commands (Find, Find Next, …)
 * can be routed to it. Replaces a static mutable field on the provider.
 */
export class ActivePanelTracker {
	private activePanel: vscode.WebviewPanel | undefined;

	/** Register a panel as active and keep the tracker in sync with its focus/disposal. */
	public track(panel: vscode.WebviewPanel): void {
		this.activePanel = panel;

		panel.onDidChangeViewState(event => {
			if (event.webviewPanel.active) {
				this.activePanel = event.webviewPanel;
			}
		});

		panel.onDidDispose(() => {
			if (this.activePanel === panel) {
				this.activePanel = undefined;
			}
		});
	}

	/** Post a message to the active panel, or do nothing if there is none. */
	public post(message: ExtensionToWebviewMessage): void {
		if (this.activePanel === undefined) {
			return;
		}

		// Swallow rejections: the active panel disposed during the async post would otherwise become
		// an unhandled rejection. onDidDispose already clears the tracked panel.
		void this.activePanel.webview.postMessage(message).then(undefined, () => { /* panel disposed mid-post */ });
	}
}
