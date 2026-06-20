import { createEffect, Show } from 'solid-js';
import type { FindMatchMessage } from '../../../../src/shared/messages/find';
import type { EditController } from '../../types';
import { HighlightedText } from '../find/HighlightedText';
import type { ActiveCell, ColumnDisplayOptions } from './types';

export function VirtualTableCell(props: {
	edit: EditController;
	columnIndex: number;
	columnOptions: ColumnDisplayOptions;
	isActive: boolean;
	isActiveMatchCell: boolean;
	isEditing: boolean;
	isGridFocused: boolean;
	onActiveCellElement: (element: HTMLDivElement) => void;
	onContextMenu: (cell: ActiveCell, value: string, x: number, y: number) => void;
	left: number;
	matches: FindMatchMessage[];
	rowIndex: number;
	sourceRowIndex: number;
	value: string;
	width: number;
	isActiveMatch: (match: FindMatchMessage) => boolean;
}) {
	const cell = (): ActiveCell => ({ rowIndex: props.rowIndex, columnIndex: props.columnIndex });
	let element!: HTMLDivElement;

	// Report this cell's element to the grid every time it becomes the active cell — not just on
	// first mount — so DOM focus can deterministically follow the cursor through keyboard navigation.
	createEffect(() => {
		if (props.isActive) {
			props.onActiveCellElement(element);
		}
	});

	function handleEditorKeyDown(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }): void {
		if (event.key === 'Enter' && event.altKey) {
			event.preventDefault();
			insertLineBreak(event.currentTarget);
			return;
		}

		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			props.edit.commitAndMove(1, 0); // commit, move down
			return;
		}

		if (event.key === 'Enter' && event.shiftKey) {
			event.preventDefault();
			props.edit.commitAndMove(-1, 0); // commit, move up
			return;
		}

		// cursor key up
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			event.stopPropagation();
			props.edit.commitAndMove(-1, 0); // commit, move up
			return;
		}

		// cursor key down
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			event.stopPropagation();
			props.edit.commitAndMove(1, 0); // commit, move down
			return;
		}

		if (event.key === 'Tab') {
			event.preventDefault();
			event.stopPropagation();
			props.edit.commitAndMove(0, event.shiftKey ? -1 : 1); // commit, move left/right
			return;
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			props.edit.cancelEdit();
			props.edit.focusGrid();
		}
	}

	function insertLineBreak(textarea: HTMLTextAreaElement): void {
		const start = textarea.selectionStart ?? props.edit.draftValue().length;
		const end = textarea.selectionEnd ?? start;
		const current = props.edit.draftValue();
		props.edit.setDraftValue(`${current.slice(0, start)}\n${current.slice(end)}`);
		queueMicrotask(() => {
			textarea.selectionStart = start + 1;
			textarea.selectionEnd = start + 1;
		});
	}

	return (
		<div
			ref={element}
			role="gridcell"
			aria-selected={props.isActive}
			tabIndex={props.isActive ? 0 : -1}
			class={dataCellClass(props.isActive, props.isActiveMatchCell, props.isGridFocused, props.edit.isEditable())}
			style={dataCellStyle(props.left, props.width, props.columnOptions, props.isActive || props.isActiveMatchCell)}
			title={props.value}
			onClick={event => {
				props.edit.setActiveCell(cell());
				event.currentTarget.focus({ preventScroll: true });
			}}
			onDblClick={() => props.edit.beginEdit(cell(), { mode: 'caret-end' })}
			onContextMenu={event => {
				event.preventDefault();
				props.onContextMenu(cell(), props.value, event.clientX, event.clientY);
			}}
		>
			<Show
				when={props.isEditing && props.edit.editOrigin() === 'cell'}
				fallback={
					<HighlightedText
						value={props.isEditing ? props.edit.draftValue() : props.value}
						matches={props.isEditing ? [] : props.matches}
						isActiveMatch={props.isActiveMatch}
					/>
				}
			>
				<textarea
					ref={element => {
						// Defer to a microtask: when the ref runs the element is not yet connected, so an
						// immediate focus() is dropped and focus stays on the cell div — where keystrokes are
						// swallowed by the grid's "ignore while editing" handler. This editor only mounts for
						// cell-initiated edits, so it always takes focus; Formula-Bar edits keep their own.
						queueMicrotask(() => {
							element.focus();
							const caret = element.value.length;
							element.setSelectionRange(caret, caret);
						});
					}}
					class="edit-tint absolute left-0 top-0 z-20 h-auto max-h-[8rem] min-h-full w-full resize-none border-0 p-1 outline outline-1 outline-[var(--vscode-focusBorder)]"
					value={props.edit.draftValue()}
					onInput={event => props.edit.setDraftValue(event.currentTarget.value)}
					onBlur={() => props.edit.commitEdit()}
					onKeyDown={handleEditorKeyDown}
					onClick={event => {
						// Prevent the grid from stealing focus when clicking inside the editor.
						event.stopPropagation();
					}}
				/>
			</Show>
		</div>
	);
}

function dataCellClass(isActive: boolean, isActiveMatchCell: boolean, isGridFocused: boolean, isEditable: boolean): string {
	const baseClass = 'absolute top-0 h-full overflow-hidden text-ellipsis whitespace-nowrap border-r border-b border-border px-2 py-1 align-top text-fg vscode-high-contrast:border-focus';

	// Cell states stack with a fixed precedence (§06): edit/invalid → active match → selected → hover.

	// Highest: the cell being edited. The tokenised red wash marks "this is what you're changing".
	if (isActive && isGridFocused && isEditable) {
		return `${baseClass} bg-[var(--vscode-inputValidation-errorBackground)] text-fg outline outline-2 -outline-offset-2 outline-error-border`;
	}

	// Active find match: solid fill + match-border outline, taking precedence over plain selection.
	if (isActiveMatchCell) {
		return `${baseClass} bg-match text-[var(--vscode-editor-foreground)] outline outline-2 -outline-offset-2 outline-[var(--vscode-editor-findMatchBorder,var(--vscode-focusBorder))]`;
	}

	// Selected (active) cell — muted when the grid is unfocused, full selection when focused.
	if (isActive) {
		if (!isGridFocused) {
			return `${baseClass} bg-[var(--vscode-list-inactiveSelectionBackground,var(--vscode-list-hoverBackground))] text-[var(--vscode-list-inactiveSelectionForeground,var(--vscode-foreground))] outline outline-2 -outline-offset-2 outline-[var(--vscode-descriptionForeground)]`;
		}

		return `${baseClass} bg-sel text-sel-fg outline outline-2 -outline-offset-2 outline-focus`;
	}

	// Resting cell — reveal a quiet hover wash.
	return `${baseClass} hover:bg-hover`;
}

function dataCellStyle(left: number, width: number, options: ColumnDisplayOptions, suppressCustomColors: boolean): Record<string, string> {
	const style: Record<string, string> = {
		left: `${left}px`,
		width: `${width}px`,
		'text-align': options.textAlign
	};

	// Text styling is not colour-based, so it stays applied even under selection / active-match states.
	// Always emit both properties (defaulting to normal/none) so reverting to "normal" reliably clears a
	// previous bold/underline, instead of relying on the style binding to drop an omitted key.
	style['font-weight'] = options.textStyle === 'bold' ? 'bold' : 'normal';
	style['text-decoration'] = options.textStyle === 'underline'
		? 'underline'
		: options.textStyle === 'strike-through'
			? 'line-through'
			: 'none';

	// Custom column colours yield to selection / active-match states so those reads stay legible.
	if (!suppressCustomColors) {
		if (options.foregroundColor !== null) {
			style.color = options.foregroundColor;
		}

		if (options.backgroundColor !== null) {
			style['background-color'] = options.backgroundColor;
		}
	}

	return style;
}
