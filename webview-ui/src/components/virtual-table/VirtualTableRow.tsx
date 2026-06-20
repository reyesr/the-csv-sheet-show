import { For } from 'solid-js';
import type { FindMatchMessage } from '../../../../src/shared/messages/find';
import type { EditController } from '../../types';
import { ROW_HEIGHT, ROW_NUMBER_COLUMN_WIDTH } from './constants';
import { VirtualTableCell } from './VirtualTableCell';
import type { ActiveCell, ColumnDisplayOptions, ColumnSizing } from './types';

export function VirtualTableRow(props: {
	edit: EditController;
	activeCell: ActiveCell;
	columnCount: number;
	editingCell: ActiveCell | null;
	getCellMatches: (rowIndex: number, cellIndex: number) => FindMatchMessage[];
	getColumnOptions: (columnIndex: number) => ColumnDisplayOptions;
	getRowDisplayNumber: (virtualRowIndex: number) => number;
	isGridFocused: boolean;
	isActiveMatch: (match: FindMatchMessage) => boolean;
	isActiveMatchCell: (rowIndex: number, cellIndex: number) => boolean;
	offsetCorrection: number;
	onActiveCellElement: (element: HTMLDivElement) => void;
	onContextMenu: (cell: ActiveCell, value: string, x: number, y: number) => void;
	rowCells: string[] | null;
	sizing: ColumnSizing;
	sourceRowIndex: number;
	top: number;
	virtualRowIndex: number;
}) {
	const columnIndexes = () => Array.from({ length: props.columnCount }, (_, index) => index);

	return (
		<div
			role="row"
			class="absolute left-0 hover:bg-[var(--vscode-list-hoverBackground)]"
			style={{ height: `${ROW_HEIGHT}px`, top: `${props.top - props.offsetCorrection}px`, width: `${props.sizing.totalTableWidth()}px` }}
		>
			<div role="rowheader" class={rowNumberCellClass} style={{ width: `${ROW_NUMBER_COLUMN_WIDTH}px` }}>
				{props.getRowDisplayNumber(props.virtualRowIndex)}
			</div>
			<For each={columnIndexes()}>
				{columnIndex => (
					<VirtualTableCell
						edit={props.edit}
						columnIndex={columnIndex}
						isActive={props.activeCell.rowIndex === props.virtualRowIndex && props.activeCell.columnIndex === columnIndex}
						isActiveMatchCell={props.isActiveMatchCell(props.sourceRowIndex, columnIndex)}
						columnOptions={props.getColumnOptions(columnIndex)}
						isEditing={props.editingCell?.rowIndex === props.virtualRowIndex && props.editingCell.columnIndex === columnIndex}
						isGridFocused={props.isGridFocused}
						onActiveCellElement={props.onActiveCellElement}
						onContextMenu={props.onContextMenu}
						left={props.sizing.columnLefts()[columnIndex] ?? ROW_NUMBER_COLUMN_WIDTH}
						matches={props.getCellMatches(props.sourceRowIndex, columnIndex)}
						rowIndex={props.virtualRowIndex}
						sourceRowIndex={props.sourceRowIndex}
						value={props.rowCells?.[columnIndex] ?? (props.rowCells === null && columnIndex === 0 ? 'Loading...' : '')}
						width={props.sizing.getColumnWidth(columnIndex)}
						isActiveMatch={props.isActiveMatch}
					/>
				)}
			</For>
		</div>
	);
}

const rowNumberCellClass = 'sticky left-0 z-10 h-full border-r border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] px-2 py-1 text-right font-mono text-[11px] text-[var(--vscode-descriptionForeground)] vscode-high-contrast:border-[var(--vscode-focusBorder)]';
