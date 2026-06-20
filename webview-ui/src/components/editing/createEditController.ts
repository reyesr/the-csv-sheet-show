import { createMemo, createSignal } from 'solid-js';
import type { ChangeAppliedMessage, ChangeRejectedMessage } from '../../../../src/shared/messages/editing';
import type { CsvGridController, EditController, EditSeed } from '../../types';
import type { ActiveCell } from '../virtual-table/types';
import { postMessage } from '../../vscode';
import { log } from '../messaging/log';

interface PendingCellEdit {
	rowIndex: number;
	columnIndex: number;
	previousValue: string;
}

interface PendingHeaderEdit {
	columnIndex: number;
	previousValue: string;
}

/**
 * Owns the shared editing state — edit mode, the active cell, and the single draft value backing
 * both the in-cell editor and the Formula Bar — and reconciles optimistic edits with the
 * extension's changeApplied / changeRejected replies. See local/features/editing.md.
 */
export function createEditController(grid: CsvGridController): EditController {
	const [isEditable, setIsEditable] = createSignal(false);
	const [activeCell, setActiveCellSignal] = createSignal<ActiveCell>({ rowIndex: 0, columnIndex: 0 });
	const [editingCell, setEditingCell] = createSignal<ActiveCell | null>(null);
	const [draftValue, setDraftValue] = createSignal('');
	const [statusMessage, setStatusMessage] = createSignal('');
	// Where the current edit was initiated: 'cell' auto-focuses the in-cell editor; 'formula' keeps
	// focus in the Formula Bar (the cell editor still mounts and live-syncs, but does not grab focus).
	const [editOrigin, setEditOrigin] = createSignal<'cell' | 'formula'>('cell');
	const [editingHeaderColumn, setEditingHeaderColumn] = createSignal<number | null>(null);
	const [headerDraft, setHeaderDraft] = createSignal('');

	const pendingCellEdits = new Map<string, PendingCellEdit>();
	const pendingHeaderEdits = new Map<string, PendingHeaderEdit>();
	// Add-header-row requests in flight; on rejection the optimistic header is reverted.
	const pendingHeaderAdds = new Set<string>();
	// True while editing the very first header cell of a header row the user just started creating on a
	// header-less file. The header is persisted (addHeaderRow) only once a non-empty name is committed.
	let pendingHeaderCreation = false;
	let requestSequence = 0;

	const activeCellValue = createMemo(() => {
		const cell = activeCell();
		return grid.getCellValue(cell.rowIndex, cell.columnIndex);
	});

	function nextRequestId(prefix: string): string {
		return `${prefix}:${requestSequence++}`;
	}

	function clampCell(cell: ActiveCell): ActiveCell {
		return {
			rowIndex: clamp(cell.rowIndex, 0, Math.max(0, grid.virtualRowCount() - 1)),
			columnIndex: clamp(cell.columnIndex, 0, Math.max(0, grid.maxColumnCount() - 1))
		};
	}

	function setActiveCell(cell: ActiveCell): void {
		setActiveCellSignal(clampCell(cell));
	}

	function moveActiveCell(rowDelta: number, columnDelta: number): void {
		const current = activeCell();
		setActiveCellSignal(clampCell({ rowIndex: current.rowIndex + rowDelta, columnIndex: current.columnIndex + columnDelta }));
	}

	function beginEdit(cell: ActiveCell, seed: EditSeed): void {
		if (!isEditable()) {
			return;
		}

		setEditOrigin('cell');
		setActiveCellSignal(cell);
		setDraftValue(seed.mode === 'replace' ? seed.value : grid.getCellValue(cell.rowIndex, cell.columnIndex));
		setEditingCell(cell);
	}

	/** Begin editing the active cell from the Formula Bar — focus stays in the bar, not the cell. */
	function beginEditFromFormulaBar(): void {
		if (!isEditable()) {
			return;
		}

		const cell = activeCell();
		setEditOrigin('formula');
		setDraftValue(grid.getCellValue(cell.rowIndex, cell.columnIndex));
		setEditingCell(cell);
	}

	function commitEdit(): void {
		const cell = editingCell();
		if (cell === null) {
			return;
		}

		setEditingCell(null);
		const value = draftValue();
		const previousValue = grid.getCellValue(cell.rowIndex, cell.columnIndex);
		if (value === previousValue) {
			return; // No-op edit: no message, no change, no dirty state.
		}

		// Optimistic: show the new value immediately, reconcile on the extension's reply.
		grid.applyLocalCellEdit(cell.rowIndex, cell.columnIndex, value);
		const requestId = nextRequestId('set-cell');
		pendingCellEdits.set(requestId, { rowIndex: cell.rowIndex, columnIndex: cell.columnIndex, previousValue });
		postMessage({ type: 'setCellContent', requestId, rowIndex: cell.rowIndex, columnIndex: cell.columnIndex, value });
	}

	function cancelEdit(): void {
		setEditingCell(null);
	}

	// --- Header editing (the single header row) ---
	// On a header-less file, starting to edit a header optimistically shows an empty header row; it is
	// only persisted (addHeaderRow) when the first non-empty name is committed. Cancelling or committing
	// empty before then reverts, so an accidental click leaves the file header-less. See the approved plan.

	function beginHeaderEdit(columnIndex: number): void {
		if (!isEditable()) {
			return;
		}

		if (!grid.headerExists()) {
			grid.applyLocalAddHeader(grid.maxColumnCount());
			pendingHeaderCreation = true;
		}

		setEditingCell(null);
		setHeaderDraft(grid.getHeaderValue(columnIndex));
		setEditingHeaderColumn(columnIndex);
	}

	function commitHeaderEdit(): void {
		const columnIndex = editingHeaderColumn();
		if (columnIndex === null) {
			return;
		}

		setEditingHeaderColumn(null);
		const value = headerDraft();

		if (pendingHeaderCreation) {
			pendingHeaderCreation = false;
			if (value === '') {
				grid.clearLocalHeader(); // Nothing named: revert the optimistic empty header (no change persisted).
				return;
			}

			// Persist the new header row, then name this column. Two messages, processed in order.
			const addRequestId = nextRequestId('add-header');
			pendingHeaderAdds.add(addRequestId);
			postMessage({ type: 'addHeaderRow', requestId: addRequestId, columnCount: grid.maxColumnCount() });

			grid.applyLocalHeaderEdit(columnIndex, value);
			const setRequestId = nextRequestId('set-header');
			pendingHeaderEdits.set(setRequestId, { columnIndex, previousValue: '' });
			postMessage({ type: 'setHeaderContent', requestId: setRequestId, columnIndex, value });
			return;
		}

		const previousValue = grid.getHeaderValue(columnIndex);
		if (value === previousValue) {
			return; // No-op edit.
		}

		grid.applyLocalHeaderEdit(columnIndex, value);
		const requestId = nextRequestId('set-header');
		pendingHeaderEdits.set(requestId, { columnIndex, previousValue });
		postMessage({ type: 'setHeaderContent', requestId, columnIndex, value });
	}

	function cancelHeaderEdit(): void {
		setEditingHeaderColumn(null);
		if (pendingHeaderCreation) {
			pendingHeaderCreation = false;
			grid.clearLocalHeader();
		}
	}

	/** Commit the open editor, move the active cell by the given delta, and return focus to the grid. */
	function commitAndMove(rowDelta: number, columnDelta: number): void {
		commitEdit();
		moveActiveCell(rowDelta, columnDelta);
		grid.focusGrid();
	}

	function focusGrid(): void {
		grid.focusGrid();
	}

	function requestEditMode(editable: boolean): void {
		// The extension is the authority; UI flips only when the editMode echo arrives.
		postMessage({ type: 'setEditMode', editable });
	}

	function insertRow(rowIndex: number): void {
		if (!isEditable()) {
			return;
		}

		cancelEdit();
		postMessage({ type: 'insertRow', requestId: nextRequestId('insert-row'), rowIndex });
	}

	function insertRowAbove(): void {
		insertRow(activeCell().rowIndex);
		moveActiveCell(1, 0);
	}

	function insertRowBelow(): void {
		insertRow(activeCell().rowIndex + 1);
	}

	function deleteActiveRow(): void {
		if (!isEditable()) {
			return;
		}

		cancelEdit();
		postMessage({ type: 'deleteRowRange', requestId: nextRequestId('delete-row'), offset: activeCell().rowIndex, count: 1 });
	}

	function handleEditMode(editable: boolean): void {
		setIsEditable(editable);
		setStatusMessage(editable ? 'Editing enabled' : 'Document is read-only');
		if (!editable) {
			cancelEdit(); // Read-only locks the UI; pending committed changes stay on the extension.
			cancelHeaderEdit();
		}
	}

	function handleChangeApplied(message: ChangeAppliedMessage): void {
		if (pendingCellEdits.delete(message.requestId) || pendingHeaderEdits.delete(message.requestId) || pendingHeaderAdds.delete(message.requestId)) {
			// Confirmed optimistic edit/add: the local state already matches; nothing more to fetch.
			return;
		}

		const { startRowIndex, endRowIndex } = message.invalidatedRange;
		if (endRowIndex !== null && endRowIndex < startRowIndex) {
			return; // Empty range (e.g. a header-only undo/redo): the re-posted headers handle the refresh.
		}

		// Structural change, undo/redo, save or revert: refresh the affected rows from the extension.
		grid.invalidateRows(startRowIndex, endRowIndex);
	}

	function handleChangeRejected(message: ChangeRejectedMessage): void {
		log('warn', 'Change was rejected', { requestId: message.requestId, reason: message.reason });
		setStatusMessage(message.reason);

		if (pendingHeaderAdds.delete(message.requestId)) {
			// The header row could not be created: drop the optimistic header entirely. The paired
			// setHeaderContent (if any) will also be rejected; its rollback is then a harmless no-op.
			grid.clearLocalHeader();
			return;
		}

		const pendingCell = pendingCellEdits.get(message.requestId);
		if (pendingCell !== undefined) {
			grid.applyLocalCellEdit(pendingCell.rowIndex, pendingCell.columnIndex, pendingCell.previousValue);
			pendingCellEdits.delete(message.requestId);
			return;
		}

		const pendingHeader = pendingHeaderEdits.get(message.requestId);
		if (pendingHeader !== undefined) {
			grid.applyLocalHeaderEdit(pendingHeader.columnIndex, pendingHeader.previousValue);
			pendingHeaderEdits.delete(message.requestId);
		}
	}

	return {
		isEditable,
		activeCell,
		editingCell,
		draftValue,
		activeCellValue,
		setActiveCell,
		moveActiveCell,
		setDraftValue,
		editOrigin,
		beginEdit,
		beginEditFromFormulaBar,
		commitEdit,
		commitAndMove,
		cancelEdit,
		editingHeaderColumn,
		headerDraft,
		beginHeaderEdit,
		setHeaderDraft,
		commitHeaderEdit,
		cancelHeaderEdit,
		focusGrid,
		requestEditMode,
		insertRowAbove,
		insertRowBelow,
		deleteActiveRow,
		handleEditMode,
		handleChangeApplied,
		handleChangeRejected,
		statusMessage
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
