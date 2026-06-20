import { For, Show } from 'solid-js';
import { defaultHeaderLabel, materializeHeaderCell } from '../../../../src/shared/headerLabels';
import type { EditController } from '../../types';
import { Badge } from '../common/Badge';
import { IconButton } from '../common/IconButton';
import { EditIcon } from '../common/icons';
import { HEADER_HEIGHT, ROW_NUMBER_COLUMN_WIDTH } from './constants';
import { ColumnOptionsButton } from './ColumnOptionsButton';
import type { ColumnOptionsAnchorRect, ColumnSizing } from './types';

export function VirtualTableHeader(props: {
	edit: EditController;
	columnCount: number;
	headerCells: string[];
	/** The file has a real, file-backed header (vs. an added one, or none). Controls label materialization. */
	hasRealHeader: boolean;
	/** A header exists and is editable (real or added) — drives the pencil's tooltip. */
	headerExists: boolean;
	activeColumnOptionsIndex: number | null;
	isFindColumnSelected: (columnIndex: number) => boolean;
	onOpenColumnOptions: (columnIndex: number, anchorRect: ColumnOptionsAnchorRect) => void;
	onColumnResizeStart: (columnIndex: number, event: PointerEvent) => void;
	onColumnResizeReset: (columnIndex: number) => void;
	sizing: ColumnSizing;
}) {
	// The displayed name for a column header. Real headers keep their value (with a `#N` fallback for
	// columns past the header's width). When there is no real header, empty/unnamed cells render as
	// `column_N` — the same label used on save/export — shown muted to signal "unnamed".
	function headerLabel(columnIndex: number): string {
		const value = props.headerCells?.[columnIndex];
		return props.hasRealHeader ? value ?? `#${columnIndex + 1}` : materializeHeaderCell(value, columnIndex);
	}

	function isSynthesizedLabel(columnIndex: number): boolean {
		const value = props.headerCells?.[columnIndex];
		return !props.hasRealHeader && (value === undefined || value === '');
	}
	function handleHeaderEditorKeyDown(event: KeyboardEvent): void {
		event.stopPropagation(); // keep grid navigation from reacting while typing in the header
		if (event.key === 'Enter') {
			event.preventDefault();
			props.edit.commitHeaderEdit();
			props.edit.focusGrid();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			props.edit.cancelHeaderEdit();
			props.edit.focusGrid();
		}
	}

	const columnIndexes = () => Array.from({ length: props.columnCount }, (_, index) => index);

	return (
		<div
			role="row"
			class="sticky top-0 z-30 bg-[var(--vscode-sideBar-background)]"
			style={{ height: `${HEADER_HEIGHT}px`, width: `${props.sizing.totalTableWidth()}px` }}
		>
			<div role="columnheader" class={rowNumberHeaderClass} style={{ width: `${ROW_NUMBER_COLUMN_WIDTH}px` }}>
				#
			</div>
			<For each={columnIndexes()}>
				{columnIndex => (
					<div
						role="columnheader"
						class={dataHeaderClass}
						style={{ left: `${props.sizing.columnLefts()[columnIndex] ?? ROW_NUMBER_COLUMN_WIDTH}px`, width: `${props.sizing.getColumnWidth(columnIndex)}px` }}
						title={headerLabel(columnIndex)}
						onDblClick={() => props.edit.beginHeaderEdit(columnIndex)}
					>
						<Show
							when={props.edit.editingHeaderColumn() === columnIndex}
							fallback={<>
								<Show when={props.isFindColumnSelected(columnIndex)}>
									<span class="absolute inset-0 bg-match-wash" aria-hidden="true" />
									<span class="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--vscode-editor-findMatchBorder,var(--vscode-focusBorder))]" aria-hidden="true" />
								</Show>
								<Show when={props.edit.isEditable()}>
									<IconButton
										class="relative z-10 mr-1 shrink-0"
										icon={<EditIcon class="h-3.5 w-3.5" />}
										title={props.headerExists ? `Edit name of column ${columnIndex + 1}` : 'Add a header row'}
										onMouseDown={event => event.preventDefault()}
										onClick={event => {
											event.preventDefault();
											event.stopPropagation();
											props.edit.beginHeaderEdit(columnIndex);
										}}
									/>
								</Show>
								<span
									class="relative z-10 truncate"
									classList={{
										'opacity-60': isSynthesizedLabel(columnIndex),
										// Find badge (~58px) is the widest right control — reserve full width whenever shown.
										'pr-16': props.isFindColumnSelected(columnIndex),
										// Otherwise reserve gear clearance only while the gear is actually visible.
										'group-hover:pr-7 group-focus-within:pr-7': !props.isFindColumnSelected(columnIndex),
										'pr-7': props.activeColumnOptionsIndex === columnIndex && !props.isFindColumnSelected(columnIndex)
									}}
								>{headerLabel(columnIndex)}</span>
								<Show when={props.isFindColumnSelected(columnIndex)}>
									<Badge class="absolute right-7 top-1/2 z-10 -translate-y-1/2" title="Included in Find" aria-label="Included in Find">
										Find
									</Badge>
								</Show>
								<ColumnOptionsButton
									columnIndex={columnIndex}
									open={props.activeColumnOptionsIndex === columnIndex}
									class={props.activeColumnOptionsIndex === columnIndex
										? 'opacity-100'
										: 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}
									onOpen={props.onOpenColumnOptions}
								/>
							</>}
						>
							<input
								type="text"
								ref={element => {
									// Defer focus: the element is not yet connected when the ref runs.
									queueMicrotask(() => {
										element.focus();
										element.select();
									});
								}}
								class="edit-tint absolute inset-0 z-20 h-full w-full border-0 px-2 text-label font-medium outline outline-1 outline-[var(--vscode-focusBorder)]"
								placeholder={props.hasRealHeader ? '' : defaultHeaderLabel(columnIndex)}
								value={props.edit.headerDraft()}
								onInput={event => props.edit.setHeaderDraft(event.currentTarget.value)}
								onBlur={() => props.edit.commitHeaderEdit()}
								onKeyDown={handleHeaderEditorKeyDown}
							/>
						</Show>
					</div>
				)}
			</For>
			<For each={columnIndexes()}>
				{columnIndex => (
					<div
						role="separator"
						aria-orientation="vertical"
						aria-label={`Resize column ${columnIndex + 1}`}
						class="group absolute top-0 z-40 h-full w-1.5 cursor-col-resize touch-none"
						style={{ left: `${props.sizing.columnLefts()[columnIndex] + props.sizing.getColumnWidth(columnIndex) - 3}px` }}
						onPointerDown={event => props.onColumnResizeStart(columnIndex, event)}
						onDblClick={() => props.onColumnResizeReset(columnIndex)}
					>
						<div class="mx-auto h-full w-px bg-transparent group-hover:bg-[var(--vscode-focusBorder)]" />
					</div>
				)}
			</For>
		</div>
	);
}

const rowNumberHeaderClass = 'sticky left-0 z-40 h-full border-r border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] px-2 py-1 text-right font-mono text-[11px] font-medium text-[var(--vscode-descriptionForeground)] vscode-high-contrast:border-[var(--vscode-focusBorder)]';
const dataHeaderClass = 'group absolute top-0 flex h-full items-center overflow-hidden whitespace-nowrap border-r border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] px-2 py-1 text-left text-[11px] font-medium text-[var(--vscode-descriptionForeground)] vscode-high-contrast:border-[var(--vscode-focusBorder)]';
