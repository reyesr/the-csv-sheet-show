import { createMemo, createSignal, onCleanup } from 'solid-js';
import type { FindCursorLocation, FindMatchMessage, FindUpdateClearMessage, FindUpdateMessage, FindVisibleRange, SearchStatusMessage } from '../../../../src/shared/messages/find';
import type { FindController } from '../../types';
import { postMessage } from '../../vscode';
import { createSearchId, findCellKey } from './findUtils';

const FIND_UPDATE_DEBOUNCE_MS = 180;
const FILTER_DEBOUNCE_MS = 250;
/** Floor for the streamed first-page window, so a comfortable first screen always streams even when the viewport is small. */
const MIN_FILTER_INITIAL_ROWS = 120;

export function createFindController(input: {
	scrollToSourceRow: (rowIndex: number, align?: 'start' | 'center') => void;
	scrollToSourceCell: (rowIndex: number, columnIndex: number, align?: 'start' | 'center') => void;
	getCursor: () => FindCursorLocation;
	getVisibleRange: () => FindVisibleRange;
	refreshRows: (startIndex: number, endIndex: number) => void;
	focusGrid: () => void;
	onFilterRowsReceived: (message: FindUpdateMessage) => void;
	onFilterClear: () => void;
}): FindController {
	const [findOpen, setFindOpen] = createSignal(false);
	const [findQuery, setFindQuery] = createSignal('');
	const [findMatchCase, setFindMatchCase] = createSignal(false);
	const [findWholeWord, setFindWholeWord] = createSignal(false);
	const [findRegex, setFindRegex] = createSignal(false);
	const [selectedFindColumns, setSelectedFindColumns] = createSignal<number[]>([]);
	const [searchSessionId, setSearchSessionId] = createSignal(createSearchId());
	const [findMatches, setFindMatches] = createSignal<FindMatchMessage[]>([]);
	const [activeFindMatch, setActiveFindMatch] = createSignal<FindMatchMessage | null>(null);
	const [findStatus, setFindStatus] = createSignal('');
	const [findFocusRequest, setFindFocusRequest] = createSignal(0);
	const [filterMode, setFilterMode] = createSignal(false);
	const [filteredTotalCount, setFilteredTotalCount] = createSignal(0);
	const [filteredIsFinal, setFilteredIsFinal] = createSignal(false);
	let updateTimer: ReturnType<typeof window.setTimeout> | null = null;
	let onlyResultSessionId: string | null = null;

	const activeFindMatchIndex = createMemo(() => {
		const active = activeFindMatch();
		if (active === null) {
			return -1;
		}

		return findMatches().findIndex(match => matchesEqual(match, active));
	});

	const findMatchesByCell = createMemo(() => {
		const map = new Map<string, FindMatchMessage[]>();
		for (const match of findMatches()) {
			const key = findCellKey(match.rowIndex, match.cellIndex);
			const existing = map.get(key);
			if (existing === undefined) {
				map.set(key, [match]);
			} else {
				existing.push(match);
			}
		}

		return map;
	});

	function showFindBar(): void {
		setFindOpen(true);
		setFindFocusRequest(value => value + 1);
		postFindRequest('open', input.getCursor());
	}

	function closeFindBar(): void {
		cancelCurrentFind();
		postFindRequest('close', input.getCursor());
		setFindOpen(false);
		setFindQuery('');
		setFindMatches([]);
		setActiveFindMatch(null);
		setFindStatus('');
		if (filterMode()) {
			input.onFilterClear();
		}
		setFilterMode(false);
		setFilteredTotalCount(0);
		setFilteredIsFinal(false);
		setSearchSessionId(createSearchId());
		input.focusGrid();
	}

	function startFind(query: string, matchCase = findMatchCase(), wholeWord = findWholeWord(), regex = findRegex(), selectedColumns = selectedFindColumns()): void {
		cancelPendingUpdate();
		setFindQuery(query);
		setFindMatchCase(matchCase);
		setFindWholeWord(wholeWord);
		setFindRegex(regex);
		setSelectedFindColumns(selectedColumns);
		setFindMatches([]);
		setActiveFindMatch(null);
		const nextSessionId = createSearchId();
		setSearchSessionId(nextSessionId);

		if (query.length === 0) {
			setFindStatus('');
			postFindRequest('update', input.getCursor(), nextSessionId, selectedColumns);
			if (!filterMode()) {
				refreshVisibleRows();
			}
			return;
		}

		setFindStatus(filterMode() ? 'Filtering... 1' : 'Searching...');
		const debounceMs = filterMode() ? FILTER_DEBOUNCE_MS : FIND_UPDATE_DEBOUNCE_MS;
		updateTimer = window.setTimeout(() => {
			postFindRequest('update', input.getCursor(), nextSessionId, selectedColumns);
			if (!filterMode()) {
				refreshVisibleRows();
			}
		}, debounceMs);
	}

	function toggleFilterMode(): void {
		const nextFilterMode = !filterMode();
		setFilterMode(nextFilterMode);
		setFindMatches([]);
		setActiveFindMatch(null);
		setFilteredTotalCount(0);
		setFilteredIsFinal(false);
		if (!nextFilterMode) {
			input.onFilterClear();
		}
		cancelPendingUpdate();
		const nextSessionId = createSearchId();
		setSearchSessionId(nextSessionId);
		if (findQuery().length === 0) {
			setFindStatus('');
			postFindRequest('update', input.getCursor(), nextSessionId);
			if (!nextFilterMode) {
				refreshVisibleRows();
			}
			return;
		}
		setFindStatus(nextFilterMode ? 'Filtering...' : 'Searching...');
		const debounceMs = nextFilterMode ? FILTER_DEBOUNCE_MS : FIND_UPDATE_DEBOUNCE_MS;
		updateTimer = window.setTimeout(() => {
			postFindRequest('update', input.getCursor(), nextSessionId);
			if (!nextFilterMode) {
				refreshVisibleRows();
			}
		}, debounceMs);
	}

	function toggleFindColumn(columnIndex: number): void {
		const selectedColumns = selectedFindColumns();
		const nextColumns = selectedColumns.includes(columnIndex)
			? selectedColumns.filter(selectedColumn => selectedColumn !== columnIndex)
			: [...selectedColumns, columnIndex].sort((left, right) => left - right);
		startFind(findQuery(), findMatchCase(), findWholeWord(), findRegex(), nextColumns);
	}

	function clearFindColumns(): void {
		if (selectedFindColumns().length === 0) {
			return;
		}

		startFind(findQuery(), findMatchCase(), findWholeWord(), findRegex(), []);
	}

	function cancelCurrentFind(): void {
		cancelPendingUpdate();
	}

	function navigateFindMatch(direction: 1 | -1): void {
		cancelPendingUpdate();
		if (findQuery().length === 0) {
			return;
		}

		setFindStatus('Searching...');
		postFindRequest(direction === 1 ? 'next' : 'previous', getNavigationCursor(direction));
	}

	function handleSearchMatches(incomingSessionId: string | undefined, range: FindVisibleRange, matches: FindMatchMessage[]): void {
		if (incomingSessionId !== undefined && incomingSessionId !== searchSessionId()) {
			return;
		}

		setFindMatches(current => [
			...current.filter(match => match.rowIndex < range.startRowIndex || match.rowIndex > range.endRowIndex),
			...matches
		]);

		if (matches.length > 0 && findStatus() === 'Searching...') {
			setFindStatus(`${matches.length.toLocaleString('en-US')} on page`);
		}
	}

	function handleSearchCursor(incomingSessionId: string, match: FindMatchMessage, wrapped: boolean): void {
		if (incomingSessionId !== searchSessionId()) {
			return;
		}

		const previousActiveMatch = activeFindMatch();
		if (wrapped && previousActiveMatch !== null && matchesEqual(previousActiveMatch, match)) {
			onlyResultSessionId = incomingSessionId;
			setFindStatus('Only result');
		}

		setActiveFindMatch(match);
		input.scrollToSourceCell(match.rowIndex, match.cellIndex, 'center');
	}

	function handleSearchStatus(message: SearchStatusMessage): void {
		if (message.searchSessionId !== searchSessionId()) {
			return;
		}

		if (message.status === 'error' || message.status === 'noResults') {
			setFindStatus(message.message ?? (message.status === 'error' ? 'Invalid regular expression' : 'No results'));
			return;
		}

		if (message.status === 'wrapped') {
			if (onlyResultSessionId === message.searchSessionId) {
				onlyResultSessionId = null;
				setFindStatus('Only result');
				return;
			}

			setFindStatus(message.message ?? 'Wrapped');
			window.setTimeout(() => {
				if (searchSessionId() === message.searchSessionId && findStatus() === message.message) {
					setFindStatus(formatMatchStatus());
				}
			}, 1200);
			return;
		}

		if (message.status === 'searching') {
			setFindStatus('Searching...');
			return;
		}

		if (findQuery().length > 0 && activeFindMatch() === null && findMatches().length === 0) {
			setFindStatus('No results');
			return;
		}

		setFindStatus(formatMatchStatus());
	}

	function handleFindUpdate(message: FindUpdateMessage): void {
		if (message.searchSessionId !== searchSessionId()) {
			return;
		}

		setFilteredTotalCount(message.totalCount);
		setFilteredIsFinal(message.isFinal);

		const newMatches = message.rows.flatMap(row => row.matches);
		if (newMatches.length > 0) {
			setFindMatches(current => [...current, ...newMatches]);
		}

		input.onFilterRowsReceived(message);

		setFindStatus(message.totalCount === 0 && message.isFinal
			? 'No results'
			: `${message.totalCount.toLocaleString('en-US')} found${message.isFinal ? '' : '…'}`);
	}

	function handleFindUpdateClear(message: FindUpdateClearMessage): void {
		if (message.searchSessionId !== searchSessionId()) {
			return;
		}

		setFilteredTotalCount(0);
		setFilteredIsFinal(false);
		setFindMatches([]);
		setActiveFindMatch(null);
		input.onFilterClear();
	}

	function handleSearchClear(incomingSessionId: string): void {
		if (incomingSessionId !== searchSessionId()) {
			return;
		}

		setFindMatches([]);
		setActiveFindMatch(null);
		setFindStatus('');
	}

	function getCellMatches(rowIndex: number, cellIndex: number): FindMatchMessage[] {
		return findMatchesByCell().get(findCellKey(rowIndex, cellIndex)) ?? [];
	}

	function isActiveCellMatch(match: FindMatchMessage): boolean {
		const active = activeFindMatch();
		return active !== null && matchesEqual(active, match);
	}

	function isActiveMatchCell(rowIndex: number, cellIndex: number): boolean {
		const active = activeFindMatch();
		return active !== null && active.rowIndex === rowIndex && active.cellIndex === cellIndex;
	}

	function isFindColumnSelected(columnIndex: number): boolean {
		return selectedFindColumns().includes(columnIndex);
	}

	function postFindRequest(action: 'open' | 'update' | 'next' | 'previous' | 'close', cursor: FindCursorLocation, sessionId = searchSessionId(), selectedColumns = selectedFindColumns()): void {
		const range = input.getVisibleRange();
		const visibleRowCount = Math.max(0, range.endRowIndex - range.startRowIndex + 1);
		postMessage({
			type: 'findRequest',
			searchSessionId: sessionId,
			action,
			query: findQuery(),
			options: {
				matchCase: findMatchCase(),
				wholeWord: findWholeWord(),
				regex: findRegex(),
				selectedColumns,
				filterMode: filterMode()
			},
			cursor,
			visibleRange: range,
			// Two screens of matching rows for the streamed first page; the extension pages the rest on demand.
			initialRowsExpected: Math.max(MIN_FILTER_INITIAL_ROWS, visibleRowCount * 2)
		});
	}

	function getNavigationCursor(direction: 1 | -1): FindCursorLocation {
		const active = activeFindMatch();
		if (active !== null) {
			return {
				rowIndex: active.rowIndex,
				cellIndex: active.cellIndex,
				charOffset: direction === 1 ? active.end : active.start
			};
		}

		const cursor = input.getCursor();
		return direction === 1 ? cursor : { ...cursor, charOffset: Number.MAX_SAFE_INTEGER };
	}

	function refreshVisibleRows(): void {
		const range = input.getVisibleRange();
		if (range.endRowIndex >= range.startRowIndex) {
			input.refreshRows(range.startRowIndex, range.endRowIndex);
		}
	}

	function cancelPendingUpdate(): void {
		if (updateTimer !== null) {
			window.clearTimeout(updateTimer);
			updateTimer = null;
		}
	}

	function formatMatchStatus(): string {
		// "124 / 3,180" — current match over the best-known total, monospace with separators (§09).
		// In filter mode the total is authoritative; in navigate mode it is the matches loaded so far,
		// shown as "?" until at least one is known.
		const total = filterMode() ? filteredTotalCount() : findMatches().length;
		const index = activeFindMatchIndex();
		if (index >= 0) {
			return `${(index + 1).toLocaleString('en-US')} / ${total > 0 ? total.toLocaleString('en-US') : '?'}`;
		}

		return total > 0 ? `${total.toLocaleString('en-US')} ${total === 1 ? 'match' : 'matches'}` : '';
	}

	onCleanup(() => cancelCurrentFind());

	return {
		findOpen,
		findQuery,
		findMatchCase,
		findWholeWord,
		findRegex,
		selectedFindColumns,
		findMatches,
		activeFindMatchIndex,
		findStatus,
		findFocusRequest,
		filterMode,
		filteredTotalCount,
		filteredIsFinal,
		currentSearchSessionId: searchSessionId,
		setFindMatchCase,
		setFindWholeWord,
		setFindRegex,
		toggleFindColumn,
		clearFindColumns,
		showFindBar,
		closeFindBar,
		toggleFilterMode,
		startFind,
		cancelCurrentFind,
		navigateFindMatch,
		handleSearchMatches,
		handleSearchCursor,
		handleSearchStatus,
		handleSearchClear,
		handleFindUpdate,
		handleFindUpdateClear,
		getCellMatches,
		isActiveCellMatch,
		isActiveMatchCell,
		isFindColumnSelected
	};
}

function matchesEqual(left: FindMatchMessage, right: FindMatchMessage): boolean {
	return left.rowIndex === right.rowIndex
		&& left.cellIndex === right.cellIndex
		&& left.start === right.start
		&& left.end === right.end;
}
