import type * as vscode from 'vscode';
import type { ExtensionToWebviewMessage } from '../shared/messages/protocol';

/**
 * Owns the set of webview panels attached to a document and the fan-out of messages to them
 * (a single targeted panel, or a broadcast to all). Centralizes the `postMessage` plumbing
 * that was previously scattered across the document.
 */
export class PanelBroadcaster {
	private readonly panels = new Set<vscode.WebviewPanel>();

	public add(panel: vscode.WebviewPanel): void {
		this.panels.add(panel);
	}

	public delete(panel: vscode.WebviewPanel): void {
		this.panels.delete(panel);
	}

	public clear(): void {
		this.panels.clear();
	}

	/** Snapshot of the currently attached panels (safe to iterate while panels mutate). */
	public getPanels(): vscode.WebviewPanel[] {
		return [...this.panels];
	}

	/** Post to one panel when `panel` is given, otherwise broadcast to every attached panel. */
	public post(message: ExtensionToWebviewMessage, panel?: vscode.WebviewPanel): void {
		if (panel !== undefined) {
			this.postTo(panel, message);
			return;
		}

		for (const currentPanel of this.panels) {
			this.postTo(currentPanel, message);
		}
	}

	// Swallow rejections: a panel disposed during the async post would otherwise become an unhandled
	// rejection. onDidDispose already removes the panel from the set.
	private postTo(panel: vscode.WebviewPanel, message: ExtensionToWebviewMessage): void {
		void panel.webview.postMessage(message).then(undefined, () => { /* panel disposed mid-post */ });
	}
}
