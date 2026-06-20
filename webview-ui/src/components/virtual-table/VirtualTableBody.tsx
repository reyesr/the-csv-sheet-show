import { For } from 'solid-js';
import type { FindMatchMessage } from '../../../../src/shared/messages/find';
import type { EditController } from '../../types';
import { VirtualTableRow } from './VirtualTableRow';
import type { ActiveCell, ColumnDisplayOptions, ColumnSizing, VirtualRowItem } from './types';

export function VirtualTableBody(props: {
	edit: EditController;
	activeCell: ActiveCell;
	columnCount: number;
	editingCell: ActiveCell | null;
	getCachedRow: (sourceRowIndex: number) => string[] | null;
	getColumnOptions: (columnIndex: number) => ColumnDisplayOptions;
	getCellMatches: (rowIndex: number, cellIndex: number) => FindMatchMessage[];
	getSourceRowIndex: (virtualRowIndex: number) => number;
	getRowDisplayNumber: (virtualRowIndex: number) => number;
	isGridFocused: boolean;
	isActiveMatch: (match: FindMatchMessage) => boolean;
	isActiveMatchCell: (rowIndex: number, cellIndex: number) => boolean;
	offsetCorrection: number;
	onActiveCellElement: (element: HTMLDivElement) => void;
	onContextMenu: (cell: ActiveCell, value: string, x: number, y: number) => void;
	rows: VirtualRowItem[];
	sizing: ColumnSizing;
	spacerHeight: number;
}) {
	return (
		// Rows are absolutely positioned children of this box. In compressed mode (large files, scale > 1)
		// the final rows can be positioned just past the capped spacer near the bottom; since the box is not
		// a scroll container, that overflow would inflate the scroll container's scrollHeight and make the
		// scroll bottom a moving target (a scroll/flash loop). `overflow: clip` clips the overflow without
		// becoming a scroll container, so the sticky header and sticky row-number column still resolve
		// against the outer scroll container. No-op when content fits (no row ever exceeds the spacer).
		<div
			role="rowgroup"
			class="relative overflow-clip"
			style={{ height: `${props.spacerHeight}px`, width: `${props.sizing.totalTableWidth()}px` }}
		>
			<For each={props.rows}>
				{row => {
					const sourceRowIndex = props.getSourceRowIndex(row.virtualRowIndex);

					return (
						<VirtualTableRow
							edit={props.edit}
							activeCell={props.activeCell}
							columnCount={props.columnCount}
							editingCell={props.editingCell}
							getCellMatches={props.getCellMatches}
							getColumnOptions={props.getColumnOptions}
							getRowDisplayNumber={props.getRowDisplayNumber}
							isGridFocused={props.isGridFocused}
							isActiveMatch={props.isActiveMatch}
							isActiveMatchCell={props.isActiveMatchCell}
							offsetCorrection={props.offsetCorrection}
							onActiveCellElement={props.onActiveCellElement}
							onContextMenu={props.onContextMenu}
							rowCells={props.getCachedRow(sourceRowIndex)}
							sizing={props.sizing}
							sourceRowIndex={sourceRowIndex}
							top={row.top}
							virtualRowIndex={row.virtualRowIndex}
						/>
					);
				}}
			</For>
		</div>
	);
}
