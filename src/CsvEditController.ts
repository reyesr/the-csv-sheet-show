import * as vscode from 'vscode';
import type { Change, CsvDocumentChanges } from './CsvDocumentChanges';
import type { CsvRowView } from './CsvRowView';
import type { InvalidatedRange } from './shared/messages/editing';
import type { ExtensionToWebviewMessage } from './shared/messages/protocol';

/**
 * The slice of the document the edit controller depends on for side effects: posting to panels,
 * invalidating cached pages, re-broadcasting statistics/headers, and the load/header state that
 * gates editing.
 */
export interface EditHost {
	post(message: ExtensionToWebviewMessage, panel?: vscode.WebviewPanel): void;
	clearPageCaches(): void;
	broadcastStatistics(): void;
	/** Re-post the header row to all panels (header edits and their undo/redo change it). */
	refreshHeaders(): void;
	/** True once indexing is final — editing is only permitted then. */
	isIndexingFinal(): boolean;
	/** True when the file has a header row that can be edited. */
	canEditHeader(): boolean;
	log(message: string): void;
}

/**
 * Owns the editable state and turns webview edit requests into change-log mutations, validating
 * each request and emitting the post-edit side effects (cache invalidation, statistics/header
 * refresh, change-applied broadcast, and the `onDidEdit` event the provider registers undo on).
 * The change log itself ({@link CsvDocumentChanges}) is shared with the document and injected.
 */
export class CsvEditController {
	private isEditable = false;
	private readonly onDidEditEmitter = new vscode.EventEmitter<{ label: string }>();
	/** Fires when the change log gains an entry, so the provider can register a VS Code edit (dirty + undo/redo). */
	public readonly onDidEdit = this.onDidEditEmitter.event;

	public constructor(
		private readonly changes: CsvDocumentChanges,
		private readonly rowView: CsvRowView,
		private readonly host: EditHost
	) { }

	public isEditMode(): boolean {
		return this.isEditable;
	}

	/** Restore the editable flag from a hot-exit backup without echoing to panels. */
	public restoreEditable(isEditable: boolean): void {
		this.isEditable = isEditable;
	}

	/** Set the editable state and echo it to every panel (the extension is the single authority). */
	public setEditMode(editable: boolean): void {
		// Editing is only allowed once indexing is final; refuse to enable before then.
		if (editable && !this.host.isIndexingFinal()) {
			this.broadcastEditMode();
			return;
		}

		this.isEditable = editable;
		this.broadcastEditMode();
	}

	public applySetCellContent(requestId: string, rowIndex: number, columnIndex: number, value: string, panel: vscode.WebviewPanel): void {
		if (!this.ensureEditable(requestId, panel)) {
			return;
		}

		if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex) || rowIndex < 0 || columnIndex < 0 || rowIndex >= this.rowView.getDisplayedReadableRowCount()) {
			this.rejectChange(requestId, 'Target cell is out of range', panel);
			return;
		}

		const change = this.changes.setCellContent(rowIndex, columnIndex, value);
		this.afterChange(change, { startRowIndex: rowIndex, endRowIndex: rowIndex }, requestId, 'Edit cell');
	}

	public applyInsertRow(requestId: string, rowIndex: number, panel: vscode.WebviewPanel): void {
		if (!this.ensureEditable(requestId, panel)) {
			return;
		}

		if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex > this.rowView.getDisplayedReadableRowCount()) {
			this.rejectChange(requestId, 'Insertion point is out of range', panel);
			return;
		}

		const change = this.changes.insertRow(rowIndex);
		this.afterChange(change, { startRowIndex: rowIndex, endRowIndex: null }, requestId, 'Insert row');
	}

	public applyDeleteRowRange(requestId: string, offset: number, count: number, panel: vscode.WebviewPanel): void {
		if (!this.ensureEditable(requestId, panel)) {
			return;
		}

		if (!Number.isInteger(offset) || !Number.isInteger(count) || offset < 0 || count <= 0 || offset + count > this.rowView.getDisplayedReadableRowCount()) {
			this.rejectChange(requestId, 'Row range is out of range', panel);
			return;
		}

		const change = this.changes.deleteRowRange(offset, count);
		this.afterChange(change, { startRowIndex: offset, endRowIndex: null }, requestId, 'Delete rows');
	}

	public applySetHeaderContent(requestId: string, columnIndex: number, value: string, panel: vscode.WebviewPanel): void {
		if (!this.ensureEditable(requestId, panel)) {
			return;
		}

		if (!this.host.canEditHeader()) {
			this.rejectChange(requestId, 'This file has no header row to edit', panel);
			return;
		}

		if (!Number.isInteger(columnIndex) || columnIndex < 0) {
			this.rejectChange(requestId, 'Target header is out of range', panel);
			return;
		}

		const change = this.changes.setHeaderContent(columnIndex, value);
		// Header edits touch no data rows: refresh the header and report an empty invalidated range.
		this.host.refreshHeaders();
		this.broadcastChangeApplied(requestId, change.changeId, { startRowIndex: 0, endRowIndex: -1 });
		this.onDidEditEmitter.fire({ label: 'Edit header' });
	}

	/**
	 * Add an (empty) header row to a header-less file so its columns can be named. Does not consume a
	 * data row — physical row 0 stays data; the header is materialized to `column_N` on save/export.
	 *
	 * Intentionally does NOT re-post the header: in the webview's create-and-name flow this is always
	 * immediately followed by a `setHeaderContent`, whose `refreshHeaders` posts the populated header
	 * (so the webview never sees an empty→named flicker). The optimistic local header already shows it.
	 */
	public applyAddHeaderRow(requestId: string, columnCount: number, panel: vscode.WebviewPanel): void {
		if (!this.ensureEditable(requestId, panel)) {
			return;
		}

		if (this.host.canEditHeader()) {
			this.rejectChange(requestId, 'This file already has a header row', panel);
			return;
		}

		if (!Number.isInteger(columnCount) || columnCount <= 0) {
			this.rejectChange(requestId, 'Invalid header column count', panel);
			return;
		}

		const change = this.changes.insertHeader(new Array<string>(columnCount).fill(''));
		this.broadcastChangeApplied(requestId, change.changeId, { startRowIndex: 0, endRowIndex: -1 });
		this.onDidEditEmitter.fire({ label: 'Add header row' });
	}

	public canUndo(): boolean {
		return this.changes.canUndo();
	}

	public canRedo(): boolean {
		return this.changes.canRedo();
	}

	/** Undo the most recent change (driven by VS Code's undo via the provider). */
	public undoEdit(): void {
		const result = this.changes.undo();
		if (result === null) {
			return;
		}

		if (result.change.type === 'set-header-content' || result.change.type === 'insert-header' || result.change.type === 'remove-header') {
			this.host.refreshHeaders();
		}
		this.refreshAfterStructuralChange(result.change.changeId, result.invalidatedRange, 'undo');
	}

	/** Redo the most recently undone change. */
	public redoEdit(): void {
		const result = this.changes.redo();
		if (result === null) {
			return;
		}

		if (result.change.type === 'set-header-content' || result.change.type === 'insert-header' || result.change.type === 'remove-header') {
			this.host.refreshHeaders();
		}
		this.refreshAfterStructuralChange(result.change.changeId, result.invalidatedRange, 'redo');
	}

	public dispose(): void {
		this.onDidEditEmitter.dispose();
	}

	private ensureEditable(requestId: string, panel: vscode.WebviewPanel): boolean {
		if (!this.isEditable) {
			this.rejectChange(requestId, 'Document is read-only', panel);
			return false;
		}

		if (!this.host.isIndexingFinal()) {
			this.rejectChange(requestId, 'File is still loading', panel);
			return false;
		}

		return true;
	}

	private rejectChange(requestId: string, reason: string, panel: vscode.WebviewPanel): void {
		this.host.log(`Rejected change ${requestId}: ${reason}`);
		this.host.post({ type: 'changeRejected', requestId, reason }, panel);
	}

	private afterChange(change: Change, invalidatedRange: InvalidatedRange, requestId: string, label: string): void {
		this.host.clearPageCaches();
		this.host.broadcastStatistics();
		this.broadcastChangeApplied(requestId, change.changeId, invalidatedRange);
		this.onDidEditEmitter.fire({ label });
	}

	private refreshAfterStructuralChange(changeId: number, invalidatedRange: InvalidatedRange, requestId: string): void {
		this.host.clearPageCaches();
		this.host.broadcastStatistics();
		this.broadcastChangeApplied(requestId, changeId, invalidatedRange);
	}

	private broadcastChangeApplied(requestId: string, changeId: number, invalidatedRange: InvalidatedRange): void {
		this.host.post({ type: 'changeApplied', requestId, changeId, invalidatedRange });
	}

	private broadcastEditMode(): void {
		this.host.post({ type: 'editMode', isEditable: this.isEditable });
	}
}
