import type { Accessor, Setter } from 'solid-js';
import type { ChangeAppliedMessage, ChangeRejectedMessage } from '../../src/shared/messages/editing';
import type { CsvFileConfigMessage } from '../../src/shared/messages/config';
import type { CsvLoadErrorReason } from '../../src/shared/messages/errors';
import type { FindCursorLocation, FindMatchMessage, FindUpdateClearMessage, FindUpdateMessage, FindVisibleRange, SearchStatusMessage } from '../../src/shared/messages/find';
import type { HeadersMessage, PageMessage, RowsMessage, RowsUnavailableMessage, StatisticsMessage } from '../../src/shared/messages/gridData';
import type { ActiveCell } from './components/virtual-table/types';

export type RowRequestReason = 'viewport' | 'prefetch' | 'ready';

export interface CsvGridController {
	csvConfig: Accessor<CsvFileConfigMessage | null>;
	statsText: Accessor<string>;
	lastEvent: Accessor<string>;
	offset: Accessor<number>;
	rowCount: Accessor<number>;
	setOffset: Setter<number>;
	setRowCount: Setter<number>;
	maxColumnCount: Accessor<number>;
	message: Accessor<string>;
	loadErrorReason: Accessor<CsvLoadErrorReason | null>;
	hasCsvHeader: Accessor<boolean>;
	/** A header exists and is editable: the file has a real header, or one was added to a header-less file. */
	headerExists: Accessor<boolean>;
	/** True when the header was added to a header-less file (its empty cells render as column_N). */
	headerInserted: Accessor<boolean>;
	isFinal: Accessor<boolean>;
	headerCells: Accessor<string[]>;
	virtualRowCount: Accessor<number>;
	cachedRowCount: Accessor<number>;
	visibleRange: Accessor<FindVisibleRange>;
	cursorLocation: Accessor<FindCursorLocation>;
	getSourceRowIndex: (virtualRowIndex: number) => number;
	getRowDisplayNumber: (virtualRowIndex: number) => number;
	getCachedRow: (rowIndex: number) => string[] | null;
	getCellValue: (rowIndex: number, columnIndex: number) => string;
	getHeaderValue: (columnIndex: number) => string;
	applyLocalCellEdit: (rowIndex: number, columnIndex: number, value: string) => string;
	applyLocalAddHeader: (columnCount: number) => void;
	clearLocalHeader: () => void;
	applyLocalHeaderEdit: (columnIndex: number, value: string) => string;
	invalidateRows: (startRowIndex: number, endRowIndex: number | null) => void;
	loadPage: () => void;
	requestVirtualRows: (startIndex: number, endIndex: number, reason: 'viewport' | 'prefetch') => void;
	refreshRows: (startIndex: number, endIndex: number) => void;
	setScrollToVirtualRow: (handler: (rowIndex: number, align: 'start' | 'center') => void) => void;
	setScrollToCell: (handler: (rowIndex: number, columnIndex: number, align: 'start' | 'center') => void) => void;
	setFocusGrid: (handler: () => void) => void;
	focusGrid: () => void;
	/** Register the table's navigation-key handler so App can forward keys when the grid is unfocused. */
	setGridNavigationKeyHandler: (handler: (event: KeyboardEvent) => void) => void;
	/** Forward a navigation key (arrows / Page Up-Down / Home / End) into the table's cursor logic. */
	handleGridNavigationKey: (event: KeyboardEvent) => void;
	setVisibleRange: Setter<FindVisibleRange>;
	setCursorLocation: Setter<FindCursorLocation>;
	setLastEvent: Setter<string>;
	markInitialBlockInFlight: () => void;
	handleStatistics: (message: StatisticsMessage) => void;
	handleHeaders: (message: HeadersMessage) => void;
	handlePage: (message: PageMessage) => void;
	handleRows: (message: RowsMessage) => void;
	handleRowsUnavailable: (message: RowsUnavailableMessage) => void;
	handleError: (reason: CsvLoadErrorReason) => void;
	scrollToSourceRow: (rowIndex: number, align?: 'start' | 'center') => void;
	scrollToSourceCell: (rowIndex: number, columnIndex: number, align?: 'start' | 'center') => void;
	applyFilterUpdate: (message: FindUpdateMessage) => void;
	clearFilterCache: () => void;
}

/** How the editor should be seeded when it opens. */
export type EditSeed =
	| { mode: 'caret-end' }           // Enter / double-click / formula-bar focus: keep current value
	| { mode: 'replace'; value: string }; // type-to-replace: start fresh with the typed character

export interface EditController {
	isEditable: Accessor<boolean>;
	activeCell: Accessor<ActiveCell>;
	editingCell: Accessor<ActiveCell | null>;
	draftValue: Accessor<string>;
	activeCellValue: Accessor<string>;
	editingHeaderColumn: Accessor<number | null>;
	headerDraft: Accessor<string>;
	beginHeaderEdit: (columnIndex: number) => void;
	setHeaderDraft: (value: string) => void;
	commitHeaderEdit: () => void;
	cancelHeaderEdit: () => void;
	setActiveCell: (cell: ActiveCell) => void;
	moveActiveCell: (rowDelta: number, columnDelta: number) => void;
	setDraftValue: (value: string) => void;
	editOrigin: Accessor<'cell' | 'formula'>;
	beginEdit: (cell: ActiveCell, seed: EditSeed) => void;
	beginEditFromFormulaBar: () => void;
	commitEdit: () => void;
	commitAndMove: (rowDelta: number, columnDelta: number) => void;
	cancelEdit: () => void;
	focusGrid: () => void;
	requestEditMode: (editable: boolean) => void;
	insertRowAbove: () => void;
	insertRowBelow: () => void;
	deleteActiveRow: () => void;
	handleEditMode: (isEditable: boolean) => void;
	handleChangeApplied: (message: ChangeAppliedMessage) => void;
	handleChangeRejected: (message: ChangeRejectedMessage) => void;
	statusMessage: Accessor<string>;
}

export interface SaveController {
	progressVisible: Accessor<boolean>;
	progressPercent: Accessor<number>;
	handleSaveStarted: () => void;
	handleSaveProgress: (percent: number) => void;
	handleSaveComplete: () => void;
}

export interface FindController {
	findOpen: Accessor<boolean>;
	findQuery: Accessor<string>;
	findMatchCase: Accessor<boolean>;
	findWholeWord: Accessor<boolean>;
	findRegex: Accessor<boolean>;
	selectedFindColumns: Accessor<number[]>;
	findMatches: Accessor<FindMatchMessage[]>;
	activeFindMatchIndex: Accessor<number>;
	findStatus: Accessor<string>;
	findFocusRequest: Accessor<number>;
	filterMode: Accessor<boolean>;
	filteredTotalCount: Accessor<number>;
	filteredIsFinal: Accessor<boolean>;
	currentSearchSessionId: Accessor<string>;
	setFindMatchCase: Setter<boolean>;
	setFindWholeWord: Setter<boolean>;
	setFindRegex: Setter<boolean>;
	toggleFindColumn: (columnIndex: number) => void;
	clearFindColumns: () => void;
	showFindBar: () => void;
	closeFindBar: () => void;
	toggleFilterMode: () => void;
	startFind: (query: string, matchCase?: boolean, wholeWord?: boolean, regex?: boolean, selectedColumns?: number[]) => void;
	cancelCurrentFind: () => void;
	navigateFindMatch: (direction: 1 | -1) => void;
	handleSearchMatches: (searchSessionId: string | undefined, range: FindVisibleRange, matches: FindMatchMessage[]) => void;
	handleSearchCursor: (searchSessionId: string, match: FindMatchMessage, wrapped: boolean) => void;
	handleSearchStatus: (message: SearchStatusMessage) => void;
	handleSearchClear: (searchSessionId: string) => void;
	handleFindUpdate: (message: FindUpdateMessage) => void;
	handleFindUpdateClear: (message: FindUpdateClearMessage) => void;
	getCellMatches: (rowIndex: number, cellIndex: number) => FindMatchMessage[];
	isActiveCellMatch: (match: FindMatchMessage) => boolean;
	isActiveMatchCell: (rowIndex: number, cellIndex: number) => boolean;
	isFindColumnSelected: (columnIndex: number) => boolean;
}
