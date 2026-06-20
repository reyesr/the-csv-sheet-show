/** Virtual row range affected by a change. `endRowIndex: null` means open-ended (a structural change shifts every following row). */
export interface InvalidatedRange {
	startRowIndex: number;
	endRowIndex: number | null;
}

export interface EditModeMessage {
	type: 'editMode';
	isEditable: boolean;
}

export interface ChangeAppliedMessage {
	type: 'changeApplied';
	requestId: string;
	changeId: number;
	invalidatedRange: InvalidatedRange;
}

export interface ChangeRejectedMessage {
	type: 'changeRejected';
	requestId: string;
	reason: string;
}

export interface SetCellContentMessage {
	type: 'setCellContent';
	requestId: string;
	rowIndex: number;
	columnIndex: number;
	value: string;
}

export interface InsertRowMessage {
	type: 'insertRow';
	requestId: string;
	/** Already normalized by the webview: add-above(i) -> i, add-below(i) -> i + 1. */
	rowIndex: number;
}

export interface DeleteRowRangeMessage {
	type: 'deleteRowRange';
	requestId: string;
	offset: number;
	count: number;
}

export interface SetHeaderContentMessage {
	type: 'setHeaderContent';
	requestId: string;
	columnIndex: number;
	value: string;
}

/** Add an (initially empty) header row to a header-less file so its columns can be named. */
export interface AddHeaderRowMessage {
	type: 'addHeaderRow';
	requestId: string;
	/** Number of empty header cells to create (the grid's current column count). */
	columnCount: number;
}

export interface SetEditModeMessage {
	type: 'setEditMode';
	editable: boolean;
}

export type EditRequestMessage = SetCellContentMessage | InsertRowMessage | DeleteRowRangeMessage | SetHeaderContentMessage | AddHeaderRowMessage;
