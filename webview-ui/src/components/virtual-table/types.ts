import type { Accessor } from 'solid-js';

export interface ActiveCell {
	rowIndex: number;
	columnIndex: number;
}

export type ColumnWidthMap = Record<number, number>;

export type ColumnTextAlignment = 'left' | 'center' | 'right';

export type ColumnTextStyle = 'normal' | 'bold' | 'underline' | 'strike-through';

export interface ColumnDisplayOptions {
	textAlign: ColumnTextAlignment;
	textStyle: ColumnTextStyle;
	foregroundColor: string | null;
	backgroundColor: string | null;
}

export type ColumnDisplayOptionsMap = Record<number, ColumnDisplayOptions>;

export interface ColumnOptionsAnchorRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

export interface ColumnOptionsPanelState {
	columnIndex: number;
	anchorRect: ColumnOptionsAnchorRect;
}

export interface ColumnSizing {
	columnLefts: Accessor<number[]>;
	getColumnWidth: (columnIndex: number) => number;
	totalTableWidth: Accessor<number>;
}

export interface VisibleRange {
	startIndex: number;
	endIndex: number;
	visibleStartIndex: number;
	visibleEndIndex: number;
	visibleCount: number;
}

export interface VirtualRowItem {
	virtualRowIndex: number;
	top: number;
}
