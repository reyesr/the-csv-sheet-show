import { createMemo, createSignal } from 'solid-js';
import type { EditController } from '../../types';
import { FormulaBarLockButton } from './FormulaBarLockButton';
import { FormulaBarTextarea } from './FormulaBarTextarea';

/**
 * Excel-style formula bar: shows the active cell's value and edits it through the same shared
 * draft as the in-cell editor. Visible only in edit mode. See local/features/editing.md.
 */
export function FormulaBar(props: {
	edit: EditController;
}) {
	// When the lock is enabled the textarea only auto-expands while focused, collapsing back to a
	// single row when focus leaves. When unlocked it always expands to fit its content.
	const [expansionLocked, setExpansionLocked] = createSignal(true);

	const isEditingActive = createMemo(() => {
		const editing = props.edit.editingCell();
		const active = props.edit.activeCell();
		return editing !== null && editing.rowIndex === active.rowIndex && editing.columnIndex === active.columnIndex;
	});

	const displayedValue = createMemo(() => (isEditingActive() ? props.edit.draftValue() : props.edit.activeCellValue()));

	function ensureEditingActive(): void {
		if (!isEditingActive()) {
			props.edit.beginEditFromFormulaBar();
		}
	}

	function handleKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			props.edit.commitAndMove(0, 0); // Commit, stay on the cell.
			return;
		}

		// Shift+Enter and Alt+Enter fall through to the textarea, inserting a line break.

		if (event.key === 'Tab') {
			event.preventDefault();
			props.edit.commitAndMove(0, event.shiftKey ? -1 : 1);
			return;
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			props.edit.cancelEdit();
			props.edit.focusGrid();
		}
	}

	return (
		<div class="flex items-start gap-2">
			<FormulaBarLockButton locked={expansionLocked()} onToggle={() => setExpansionLocked(locked => !locked)} />
			<FormulaBarTextarea
				value={displayedValue()}
				expansionLocked={expansionLocked()}
				onFocus={ensureEditingActive}
				onInput={value => {
					ensureEditingActive();
					props.edit.setDraftValue(value);
				}}
				onKeyDown={handleKeyDown}
				onBlur={() => props.edit.commitEdit()}
			/>
		</div>
	);
}
