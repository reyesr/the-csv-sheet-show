export interface FindMatchMessage {
	rowIndex: number;
	cellIndex: number;
	start: number;
	end: number;
}

export interface FindCursorLocation {
	rowIndex: number;
	cellIndex: number;
	charOffset: number;
}

export interface FindVisibleRange {
	startRowIndex: number;
	endRowIndex: number;
}

export interface FindOptionsMessage {
	matchCase: boolean;
	wholeWord: boolean;
	regex: boolean;
	selectedColumns: number[];
	filterMode?: boolean;
}

export type FindAction = 'open' | 'update' | 'next' | 'previous' | 'close';

export interface SearchMatchesMessage {
	type: 'searchMatches';
	searchSessionId: string;
	range: FindVisibleRange;
	matches: FindMatchMessage[];
}

export interface SearchCursorMessage {
	type: 'searchCursor';
	searchSessionId: string;
	match: FindMatchMessage;
	wrapped: boolean;
}

export interface SearchStatusMessage {
	type: 'searchStatus';
	searchSessionId: string;
	status: 'ready' | 'searching' | 'noResults' | 'wrapped' | 'error';
	message?: string;
}

export interface SearchClearMessage {
	type: 'searchClear';
	searchSessionId: string;
}

export interface FilteredRowData {
	offset: number;
	cells: string[];
	matches: FindMatchMessage[];
}

export interface FindUpdateMessage {
	type: 'findUpdate';
	searchSessionId: string;
	totalCount: number;
	bytesProcessed: number;
	totalBytes: number;
	rows: FilteredRowData[];
	isFinal: boolean;
}

export interface FindUpdateClearMessage {
	type: 'findUpdateClear';
	searchSessionId: string;
}

export interface ShowFindMessage {
	type: 'showFind';
}

export interface FindNextMessage {
	type: 'findNext';
}

export interface FindPreviousMessage {
	type: 'findPrevious';
}

export interface CloseFindMessage {
	type: 'closeFind';
}

export interface FindRequestMessage {
	type: 'findRequest';
	searchSessionId: string;
	action: FindAction;
	query: string;
	options: FindOptionsMessage;
	cursor: FindCursorLocation;
	visibleRange: FindVisibleRange;
	/** Filter mode: number of matching rows whose data the extension should stream for the first page (2 × viewport). */
	initialRowsExpected?: number;
}
