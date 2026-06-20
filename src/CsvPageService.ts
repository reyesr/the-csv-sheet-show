import type * as vscode from 'vscode';
import type { CsvFileConfig } from './csv/CsvFileConfig';
import type { FindMatchMessage } from './shared/messages/find';
import type { ExtensionToWebviewMessage } from './shared/messages/protocol';

/** A materialized block of displayed rows, cached per panel. */
export interface PageCache {
	offset: number;
	rowCount: number;
	rows: string[][];
}

/**
 * The slice of the document the paging service depends on: row reading, range checks, the panel
 * fan-out, load/disposal state, and the find overlay. Keeps paging decoupled from the document's
 * loading/editing/config concerns.
 */
export interface PageHost {
	getPanels(): vscode.WebviewPanel[];
	post(message: ExtensionToWebviewMessage, panel?: vscode.WebviewPanel): void;
	readVirtualRows(offset: number, rowCount: number): string[][];
	canReadDisplayedRange(offset: number, rowCount: number): boolean;
	getDisplayedReadableRowCount(): number;
	getConfig(): CsvFileConfig | null;
	isDisposed(): boolean;
	/** True once indexing of the file is final (the whole row count is known). */
	isIndexingFinal(): boolean;
	/** Re-send the edit-mode state to a freshly-listening panel (opening-handshake race guard). */
	postEditMode(panel: vscode.WebviewPanel): void;
	/** Filter mode: serve the page from the find subsystem; returns true when it handled the request. */
	tryServeFilteredPage(requestId: string, offset: number, rowCount: number, panel: vscode.WebviewPanel): boolean;
	/** Search overlay (session id + matches) to merge into a page/rows payload. */
	getSearchPayloadForPage(panel: vscode.WebviewPanel, page: PageCache): { searchSessionId?: string; matches?: FindMatchMessage[] };
	log(message: string): void;
}

/**
 * Serves row/page data to webview panels and owns the per-panel page cache plus the "ready" page
 * requests that are deferred until their range becomes readable.
 */
export class CsvPageService {
	private readonly pageCaches = new Map<vscode.WebviewPanel, PageCache>();
	private readonly pendingReadyPageRequests = new Map<vscode.WebviewPanel, { offset: number; rowCount: number }>();

	public constructor(private readonly host: PageHost) { }

	public postReadyPageWhenAvailable(offset: number, rowCount: number, panel: vscode.WebviewPanel): void {
		if (this.host.isDisposed()) {
			return;
		}

		// The webview is now listening; (re)send the edit-mode state in case the opening handshake raced its listener.
		this.host.postEditMode(panel);
		this.pendingReadyPageRequests.set(panel, { offset, rowCount });
		this.postPendingReadyPageIfAvailable(panel);
	}

	public postRowsIfAvailable(requestId: string, offset: number, rowCount: number, panel: vscode.WebviewPanel): void {
		if (this.host.isDisposed()) {
			return;
		}

		if (this.host.tryServeFilteredPage(requestId, offset, rowCount, panel)) {
			return;
		}

		if (!this.host.canReadDisplayedRange(offset, rowCount)) {
			this.host.log(`Rows unavailable for webview: request=${requestId}, offset=${offset}, rowCount=${rowCount}, readable=${this.host.getDisplayedReadableRowCount()}, final=${this.host.isIndexingFinal()}`);
			this.host.post({
				type: 'rows-unavailable',
				requestId,
				offset,
				rowCount,
				readableRowCount: this.host.getDisplayedReadableRowCount(),
				isFinal: this.host.isIndexingFinal()
			}, panel);
			return;
		}

		const page = this.getCachedPage(offset, rowCount, panel);
		const searchPayload = this.host.getSearchPayloadForPage(panel, page);
		this.host.log(`Sending rows to webview: request=${requestId}, offset=${offset}, requested=${rowCount}, returned=${page.rows.length}, firstRowCells=${page.rows[0]?.length ?? 0}`);

		this.host.post({
			type: 'rows',
			requestId,
			offset,
			rowCount: page.rows.length,
			rows: page.rows,
			...searchPayload
		}, panel);
	}

	public postPage(offset: number, rowCount: number, panel?: vscode.WebviewPanel): void {
		if (this.host.isDisposed()) {
			return;
		}

		const targetPanels = panel === undefined ? this.host.getPanels() : [panel];
		for (const targetPanel of targetPanels) {
			const page = this.getCachedPage(offset, rowCount, targetPanel);
			const searchPayload = this.host.getSearchPayloadForPage(targetPanel, page);
			this.host.log(`Sending page to webview: offset=${offset}, requested=${rowCount}, returned=${page.rows.length}, firstRowCells=${page.rows[0]?.length ?? 0}`);

			this.host.post({
				type: 'page',
				offset,
				rowCount: page.rows.length,
				rows: page.rows,
				...searchPayload
			}, targetPanel);
		}
	}

	/** Re-attempt every panel's deferred "ready" page; called whenever more rows become readable. */
	public postPendingPagesIfAvailable(): void {
		for (const panel of this.host.getPanels()) {
			this.postPendingReadyPageIfAvailable(panel);
		}
	}

	/** A per-panel cached page (shared with the find path) covering the given range. */
	public getCachedPage(offset: number, rowCount: number, panel: vscode.WebviewPanel): PageCache {
		const cached = this.pageCaches.get(panel);
		if (cached !== undefined && cached.offset === offset && cached.rowCount === rowCount) {
			return cached;
		}

		if (this.host.getConfig() === null) {
			throw new Error('Cannot read rows before CSV configuration is available');
		}

		const rows = this.host.readVirtualRows(offset, rowCount);
		const page: PageCache = { offset, rowCount, rows };
		this.pageCaches.set(panel, page);
		return page;
	}

	/** Drop all cached pages (e.g. after an edit, save, revert, or config change). */
	public clearCaches(): void {
		this.pageCaches.clear();
	}

	/** Forget the per-panel state for a disposed panel. */
	public disposePanel(panel: vscode.WebviewPanel): void {
		this.pageCaches.delete(panel);
		this.pendingReadyPageRequests.delete(panel);
	}

	public dispose(): void {
		this.pageCaches.clear();
		this.pendingReadyPageRequests.clear();
	}

	private postPendingReadyPageIfAvailable(panel: vscode.WebviewPanel): void {
		const request = this.pendingReadyPageRequests.get(panel);
		if (request === undefined || !this.host.canReadDisplayedRange(request.offset, request.rowCount)) {
			return;
		}

		this.postRowsIfAvailable('loaded-ready', request.offset, request.rowCount, panel);
		this.pendingReadyPageRequests.delete(panel);
	}
}
