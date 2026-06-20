import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from 'solid-js';
import { copyTextToClipboard } from '../../clipboard';
import { createRememberedSignal } from '../../remembered';
import type { CsvGridController, EditController, FindController, SaveController } from '../../types';
import { CellContextMenu, type ContextMenuItem } from './CellContextMenu';
import { ColumnOptionsPanel } from './ColumnOptionsPanel';
import { EmptyState } from '../common/EmptyState';
import { LoadErrorState } from '../common/LoadErrorState';
import {
	DEFAULT_COLUMN_WIDTH,
	HEADER_HEIGHT,
	MAX_SCROLL_HEIGHT,
	MIN_COLUMN_WIDTH,
	OVERSCAN_ROWS,
	PAGE_MOVE_RATIO,
	ROW_HEIGHT,
	ROW_NUMBER_COLUMN_WIDTH
} from './constants';
import type { ActiveCell, ColumnWidthMap, VisibleRange, VirtualRowItem } from './types';
import type { createColumnOptionsController } from './createColumnOptionsController';
import { VirtualTableBody } from './VirtualTableBody';
import { VirtualTableHeader } from './VirtualTableHeader';

export function VirtualTable(props: {
	grid: CsvGridController;
	find: FindController;
	edit: EditController;
	save: SaveController;
	columnOptions: ReturnType<typeof createColumnOptionsController>;
}) {
	let scrollElement: HTMLDivElement | undefined;
	let activeCellElement: HTMLDivElement | undefined;
	const [scrollTop, setScrollTop] = createSignal(0);
	const [viewportHeight, setViewportHeight] = createSignal(0);
	// The DOM's real maximum scrollTop (scrollHeight - clientHeight), measured rather than computed so the
	// scroll<->content map's bottom endpoint stays exact even when scale is large (see scale below).
	const [scrollMax, setScrollMax] = createSignal(0);
	const [isGridFocused, setIsGridFocused] = createSignal(false);
	// Column widths persist per file: committed widths are remembered (extension-backed) and reloaded on
	// next open. While a divider is being dragged the live width is a transient override on the resized
	// column only; it is committed to memory on pointer release (see startColumnResize).
	const storedColumnWidths = createRememberedSignal<ColumnWidthMap>('grid.columnWidths', { scope: 'file', default: {} });
	const [resizingColumn, setResizingColumn] = createSignal<{ columnIndex: number; width: number } | null>(null);
	const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number; value: string } | null>(null);
	const columnOptions = props.columnOptions;

	const activeCell = () => props.edit.activeCell();
	// While the extension materializes a save it rejects every edit (see CsvDocument.rejectIfSaving), so
	// freeze the grid to make that unmistakable. Tied to the save indicator's debounced visibility so a
	// quick save doesn't flash a disabled overlay.
	const editingPaused = () => props.save.progressVisible();
	const columnCount = createMemo(() => Math.max(1, props.grid.maxColumnCount()));
	const getColumnWidth = (columnIndex: number) => {
		const resizing = resizingColumn();
		const width = resizing?.columnIndex === columnIndex
			? resizing.width
			: storedColumnWidths.value()[columnIndex] ?? DEFAULT_COLUMN_WIDTH;
		return Math.max(MIN_COLUMN_WIDTH, width);
	};
	const columnLefts = createMemo(() => {
		let left = ROW_NUMBER_COLUMN_WIDTH;
		return Array.from({ length: columnCount() }, (_, columnIndex) => {
			const columnLeft = left;
			left += getColumnWidth(columnIndex);
			return columnLeft;
		});
	});
	const totalTableWidth = createMemo(() => ROW_NUMBER_COLUMN_WIDTH + columnLefts().reduce((totalWidth, _left, columnIndex) => totalWidth + getColumnWidth(columnIndex), 0));
	const sizing = {
		columnLefts,
		getColumnWidth,
		totalTableWidth
	};

	// Drag the divider on a column's right edge to resize it live. Pointer capture keeps move/up
	// events flowing to the handle even when the cursor leaves it, and auto-cleans on release.
	function startColumnResize(columnIndex: number, event: PointerEvent): void {
		event.preventDefault();
		event.stopPropagation();
		const handle = event.currentTarget as HTMLElement;
		handle.setPointerCapture(event.pointerId);
		const startX = event.clientX;
		const startWidth = getColumnWidth(columnIndex);
		document.body.style.cursor = 'col-resize';

		const onMove = (move: PointerEvent) => {
			const next = Math.max(MIN_COLUMN_WIDTH, startWidth + (move.clientX - startX));
			setResizingColumn({ columnIndex, width: next });
		};
		const onEnd = (end: PointerEvent) => {
			handle.releasePointerCapture(end.pointerId);
			handle.removeEventListener('pointermove', onMove);
			handle.removeEventListener('pointerup', onEnd);
			handle.removeEventListener('pointercancel', onEnd);
			document.body.style.cursor = '';
			// Commit the dragged width to per-file memory on release (the user lifting the mouse button).
			const resizing = resizingColumn();
			if (resizing?.columnIndex === columnIndex) {
				storedColumnWidths.set({ ...storedColumnWidths.value(), [columnIndex]: resizing.width });
			}
			setResizingColumn(null);
		};
		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', onEnd);
		handle.addEventListener('pointercancel', onEnd);
	}

	function resetColumnWidth(columnIndex: number): void {
		const current = storedColumnWidths.value();
		if (current[columnIndex] === undefined) {
			return;
		}

		const next = { ...current };
		delete next[columnIndex];
		storedColumnWidths.set(next);
	}

	// Decouple the scrollbar's pixel range from the true content layout. A 1:1 spacer overflows the
	// browser's element-height limit on multi-million-row CSVs, clamping scrollTop so the tail is
	// unreachable. Cap the spacer at MAX_SCROLL_HEIGHT and map scrollbar <-> content position by a
	// scale factor; when content fits, scale is 1 and every formula reduces to a plain 1:1 table.
	const naturalHeight = createMemo(() => props.grid.virtualRowCount() * ROW_HEIGHT);
	const spacerHeight = createMemo(() => Math.min(naturalHeight(), MAX_SCROLL_HEIGHT));
	// The content position the viewport top must reach for the last row to sit flush at the bottom. The
	// sticky header is a flow sibling above the rows, so the content the scrollbar traverses is
	// HEADER_HEIGHT taller than the rows alone — the browser measures scrollMax the same way.
	const contentScrollMax = createMemo(() => Math.max(0, naturalHeight() + HEADER_HEIGHT - viewportHeight()));
	// Map against the DOM's measured maximum scrollTop, not an analytic spacer estimate. With scale ~26 on
	// huge files a sub-pixel gap between our viewport estimate and the browser's integer clientHeight
	// amplifies into a whole row, leaving the last row unreachable; anchoring to scrollMax makes
	// scrollTop = scrollMax land exactly on contentScrollMax (last row bottom-aligned).
	const scale = createMemo(() => {
		const max = scrollMax();
		if (max <= 0) {
			return 1;
		}
		return Math.max(1, contentScrollMax() / max);
	});
	// Where the viewport top sits in true content space, and the amount to subtract from each row's
	// content-absolute top so its on-screen position tracks the (compressed) scrollbar. Both collapse
	// to the identity / 0 when not scaled, keeping the rendered layout identical to today.
	const contentScrollTop = createMemo(() => Math.min(scrollTop() * scale(), contentScrollMax()));
	const offsetCorrection = createMemo(() => contentScrollTop() - scrollTop());
	const contentToScroll = (contentPx: number) => contentPx / scale();

	// scrollMax is measured from the DOM. Re-measure when the spacer grows as rows stream in or shrinks on
	// delete: the scroll container itself isn't resized then, so the ResizeObserver in setScrollContainer
	// never fires for these. rAF lets the new spacer height lay out before reading scrollHeight.
	createEffect(() => {
		spacerHeight();
		const element = scrollElement;
		if (element === undefined) {
			return;
		}
		const frame = requestAnimationFrame(() => setScrollMax(Math.max(0, element.scrollHeight - element.clientHeight)));
		onCleanup(() => cancelAnimationFrame(frame));
	});

	const visibleRange = createMemo<VisibleRange>(() => {
		const rowCount = props.grid.virtualRowCount();
		if (rowCount === 0) {
			return { startIndex: 0, endIndex: -1, visibleStartIndex: 0, visibleEndIndex: -1, visibleCount: 0 };
		}

		const visibleCount = Math.max(1, Math.ceil(viewportHeight() / ROW_HEIGHT));
		const visibleStartIndex = clamp(Math.floor(contentScrollTop() / ROW_HEIGHT), 0, rowCount - 1);
		const visibleEndIndex = clamp(visibleStartIndex + visibleCount - 1, 0, rowCount - 1);
		return {
			startIndex: Math.max(0, visibleStartIndex - OVERSCAN_ROWS),
			endIndex: Math.min(rowCount - 1, visibleEndIndex + OVERSCAN_ROWS),
			visibleStartIndex,
			visibleEndIndex,
			visibleCount
		};
	});

	// Cache one item per virtualRowIndex so <For> (reference-keyed) reuses the row's DOM node across
	// recomputes instead of recreating it. This keeps DOM focus on the active cell through the
	// re-renders caused by insert/delete, the edit toggle, and scrolling. `top` is constant per index.
	const rowItemCache = new Map<number, VirtualRowItem>();
	const visibleRows = createMemo<VirtualRowItem[]>(() => {
		const range = visibleRange();
		if (range.endIndex < range.startIndex) {
			rowItemCache.clear();
			return [];
		}

		const items: VirtualRowItem[] = [];
		for (let virtualRowIndex = range.startIndex; virtualRowIndex <= range.endIndex; virtualRowIndex++) {
			let item = rowItemCache.get(virtualRowIndex);
			if (item === undefined) {
				item = { virtualRowIndex, top: virtualRowIndex * ROW_HEIGHT };
				rowItemCache.set(virtualRowIndex, item);
			}
			items.push(item);
		}

		for (const key of rowItemCache.keys()) {
			if (key < range.startIndex || key > range.endIndex) {
				rowItemCache.delete(key);
			}
		}

		return items;
	});

	createEffect(() => {
		const range = visibleRange();
		props.grid.setVisibleRange({ startRowIndex: range.visibleStartIndex, endRowIndex: range.visibleEndIndex });
		if (range.endIndex < range.startIndex) {
			return;
		}

		props.grid.requestVirtualRows(range.startIndex, range.endIndex, 'viewport');
	});

	createEffect(() => {
		props.grid.setScrollToVirtualRow((rowIndex, align) => scrollToRow(rowIndex, align));
		props.grid.setScrollToCell((rowIndex, columnIndex, align) => scrollToCell(rowIndex, columnIndex, align));
		props.grid.setFocusGrid(focusGridCursor);
		props.grid.setGridNavigationKeyHandler(handleGridNavigationKey);
		onCleanup(() => props.grid.setScrollToVirtualRow(() => { }));
		onCleanup(() => props.grid.setScrollToCell(() => { }));
		onCleanup(() => props.grid.setFocusGrid(() => { }));
		onCleanup(() => props.grid.setGridNavigationKeyHandler(() => { }));
	});

	// When a save freezes the grid, close any open editor so no live editor lingers (and keeps keyboard
	// focus) beneath the disabled overlay.
	createEffect(() => {
		if (editingPaused()) {
			props.edit.cancelEdit();
			props.edit.cancelHeaderEdit();
		}
	});

	// Re-clamp the active cell when the grid shrinks (e.g. rows deleted).
	createEffect(() => {
		const rowCount = props.grid.virtualRowCount();
		const columns = columnCount();
		const current = activeCell();
		const nextRowIndex = clamp(current.rowIndex, 0, Math.max(0, rowCount - 1));
		const nextColumnIndex = clamp(current.columnIndex, 0, columns - 1);
		if (nextRowIndex !== current.rowIndex || nextColumnIndex !== current.columnIndex) {
			props.edit.setActiveCell({ rowIndex: nextRowIndex, columnIndex: nextColumnIndex });
		}
	});

	// Mirror the active cell into the grid cursor (used by find) and keep it in view.
	createEffect(() => {
		const current = activeCell();
		props.grid.setCursorLocation({ rowIndex: current.rowIndex, cellIndex: current.columnIndex, charOffset: 0 });
		// Read the current scroll position without subscribing to it; otherwise this effect would
		// re-fire on every scrollbar move and snap the viewport back onto the (unchanged) active cell.
		untrack(() => scrollCellIntoView(current));
	});

	function measureScrollMetrics(element: HTMLDivElement): void {
		// clientHeight is the integer height the browser also uses to derive the maximum scrollTop;
		// ResizeObserver's contentRect.height is sub-pixel and would desync scale's two coordinate spaces.
		setViewportHeight(element.clientHeight);
		setScrollMax(Math.max(0, element.scrollHeight - element.clientHeight));
	}

	function setScrollContainer(element: HTMLDivElement): void {
		scrollElement = element;
		measureScrollMetrics(element);
		setScrollTop(element.scrollTop);

		const resizeObserver = new ResizeObserver(() => measureScrollMetrics(element));
		resizeObserver.observe(element);
		onCleanup(() => resizeObserver.disconnect());
	}

	function handleScroll(event: Event): void {
		const element = event.currentTarget as HTMLDivElement;
		setScrollTop(element.scrollTop);
	}

	function focusGridCursor(): void {
		queueMicrotask(() => (activeCellElement ?? scrollElement)?.focus({ preventScroll: true }));
	}

	function handleGridFocusIn(): void {
		setIsGridFocused(true);
	}

	function handleGridFocusOut(event: FocusEvent): void {
		const nextFocused = event.relatedTarget;
		if (!(nextFocused instanceof Node) || !scrollElement?.contains(nextFocused)) {
			setIsGridFocused(false);
		}
	}

	// Called whenever a cell becomes the active cell. Track it and move DOM focus onto it so the focus
	// ring follows the cursor — but only when the grid already owns focus.
	function handleActiveCellElement(element: HTMLDivElement): void {
		activeCellElement = element;
		if (props.edit.editingCell() !== null || props.edit.editingHeaderColumn() !== null) {
			return;
		}

		// Only follow the cursor with DOM focus when the grid already owns it: focus sits on a cell, or
		// was stranded on <body> when the previously focused cell got recycled out of the virtual window
		// during keyboard navigation. When another control owns focus (a toolbar button, the find input),
		// navigate without yanking focus away from it — keys still reach the grid via App's forwarder.
		const focused = document.activeElement;
		const gridOwnsFocus = focused === document.body || (scrollElement?.contains(focused) ?? false);
		if (!gridOwnsFocus) {
			return;
		}

		queueMicrotask(() => activeCellElement?.focus({ preventScroll: true }));
	}

	// Ctrl+C copies the active cell. Intercepting the native copy event needs no clipboard
	// permission and leaves text selection / in-cell editing copies to the browser.
	onMount(() => {
		const onCopy = (event: ClipboardEvent) => {
			if (props.edit.editingCell() !== null || scrollElement === undefined || !scrollElement.contains(document.activeElement)) {
				return;
			}

			const activeElement = document.activeElement;
			if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
				return;
			}

			if ((window.getSelection()?.toString() ?? '') !== '') {
				return;
			}

			event.clipboardData?.setData('text/plain', props.edit.activeCellValue());
			event.preventDefault();
		};

		document.addEventListener('copy', onCopy);
		onCleanup(() => document.removeEventListener('copy', onCopy));
	});

	function openContextMenu(cell: ActiveCell, value: string, x: number, y: number): void {
		props.edit.setActiveCell(cell);
		setContextMenu({ x, y, value });
	}

	function closeContextMenu(): void {
		setContextMenu(null);
		props.edit.focusGrid();
	}

	function closeColumnOptions(): void {
		columnOptions.closeColumnOptions();
		props.edit.focusGrid();
	}

	// Subtitle for the column options panel: a real header's column name, or null to fall back to the
	// generic "Display options". Empty/missing header cells have no meaningful name, so they fall back too.
	function columnOptionsHeaderLabel(columnIndex: number): string | null {
		if (!props.grid.hasCsvHeader()) {
			return null;
		}
		const value = props.grid.headerCells()[columnIndex];
		return value !== undefined && value !== '' ? value : null;
	}

	function contextMenuItems(value: string): ContextMenuItem[] {
		const items: ContextMenuItem[] = [{ label: 'Copy', action: () => copyTextToClipboard(value) }];
		if (props.edit.isEditable()) {
			items.push(
				{ label: 'Insert row above', action: () => props.edit.insertRowAbove() },
				{ label: 'Insert row below', action: () => props.edit.insertRowBelow() },
				{ label: 'Delete row', action: () => props.edit.deleteActiveRow() }
			);
		}
		return items;
	}

	function handleKeyDown(event: KeyboardEvent): void {
		// Grid frozen mid-save: start no edit or navigation. Keys still bubble so Ctrl+S/-C/-F keep working.
		if (editingPaused()) {
			return;
		}

		// While a cell or header editor is open it owns the keyboard; let it handle the event.
		if (props.edit.editingCell() !== null || props.edit.editingHeaderColumn() !== null) {
			return;
		}

		const current = activeCell();

		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			props.edit.beginEdit(current, { mode: 'caret-end' });
			return;
		}

		// Arrows / Page Up-Down / Home / End: shared with App's <main> forwarder so they keep working
		// even when the grid does not hold focus. Consumed keys stopPropagation, so a key handled here
		// (grid focused) never bubbles to <main> to be forwarded back.
		if (handleNavigationKey(event)) {
			return;
		}

		if (event.key === 'Tab') {
			// Tab moves between columns only while the grid is focused; App never forwards it, so it
			// stays normal focus traversal everywhere else.
			event.preventDefault();
			event.stopPropagation();
			moveActiveCell({ ...current, columnIndex: current.columnIndex + (event.shiftKey ? -1 : 1) });
			return;
		}

		if (isTypeToEdit(event)) {
			// Excel "type to replace": typing on a selected cell starts editing with that character.
			event.preventDefault();
			event.stopPropagation();
			props.edit.beginEdit(current, { mode: 'replace', value: event.key });
			return;
		}

		// Key the grid does not consume (e.g. Ctrl+S): let it bubble so VS Code can act on it.
	}

	// Pure cursor navigation (arrows, Page Up/Down, Home, End). Returns true when it consumed the key.
	// Shared by the grid's own onKeyDown and App's <main> forwarder (via handleGridNavigationKey).
	function handleNavigationKey(event: KeyboardEvent): boolean {
		const current = activeCell();
		let next: ActiveCell;
		if (event.key === 'ArrowUp') {
			next = { ...current, rowIndex: current.rowIndex - 1 };
		} else if (event.key === 'ArrowDown') {
			next = { ...current, rowIndex: current.rowIndex + 1 };
		} else if (event.key === 'ArrowLeft') {
			next = { ...current, columnIndex: current.columnIndex - 1 };
		} else if (event.key === 'ArrowRight') {
			next = { ...current, columnIndex: current.columnIndex + 1 };
		} else if (event.key === 'PageUp') {
			next = { ...current, rowIndex: current.rowIndex - getPageMoveRows() };
		} else if (event.key === 'PageDown') {
			next = { ...current, rowIndex: current.rowIndex + getPageMoveRows() };
		} else if (event.key === 'Home') {
			next = event.ctrlKey || event.metaKey ? { rowIndex: 0, columnIndex: 0 } : { ...current, columnIndex: 0 };
		} else if (event.key === 'End') {
			const lastColumn = columnCount() - 1;
			next = event.ctrlKey || event.metaKey
				? { rowIndex: props.grid.virtualRowCount() - 1, columnIndex: lastColumn }
				: { ...current, columnIndex: lastColumn };
		} else {
			return false;
		}

		event.preventDefault();
		event.stopPropagation();
		moveActiveCell(next);
		return true;
	}

	// Entry point for navigation keys forwarded from <main> when the grid does not hold focus. App
	// filters by key only, so re-apply the save/edit guards here before moving the cursor.
	function handleGridNavigationKey(event: KeyboardEvent): void {
		if (editingPaused()) {
			return;
		}

		if (props.edit.editingCell() !== null || props.edit.editingHeaderColumn() !== null) {
			return;
		}

		handleNavigationKey(event);
	}

	function moveActiveCell(next: ActiveCell): void {
		props.edit.setActiveCell({
			rowIndex: clamp(next.rowIndex, 0, Math.max(0, props.grid.virtualRowCount() - 1)),
			columnIndex: clamp(next.columnIndex, 0, columnCount() - 1)
		});
	}

	function isTypeToEdit(event: KeyboardEvent): boolean {
		return props.edit.isEditable() && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
	}

	function getPageMoveRows(): number {
		return Math.max(1, Math.floor(visibleRange().visibleCount * PAGE_MOVE_RATIO));
	}

	function scrollToRow(rowIndex: number, align: 'start' | 'center'): void {
		if (scrollElement === undefined) {
			return;
		}

		const viewport = scrollElement.clientHeight;
		// Target is computed in content space, then mapped to the (possibly compressed) scroll space.
		const rawContentTop = align === 'center'
			? rowIndex * ROW_HEIGHT - Math.max(0, viewport - ROW_HEIGHT) / 2
			: rowIndex * ROW_HEIGHT;
		const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
		scrollElement.scrollTop = clamp(contentToScroll(rawContentTop), 0, maxScrollTop);
		setScrollTop(scrollElement.scrollTop);
	}

	function scrollToCell(rowIndex: number, columnIndex: number, align: 'start' | 'center'): void {
		props.edit.setActiveCell({
			rowIndex: clamp(rowIndex, 0, Math.max(0, props.grid.virtualRowCount() - 1)),
			columnIndex: clamp(columnIndex, 0, columnCount() - 1)
		});
		scrollToRow(rowIndex, align);
		scrollColumnIntoView(columnIndex);
	}

	function scrollCellIntoView(cell: ActiveCell): void {
		if (scrollElement === undefined) {
			return;
		}

		scrollToRowInView(cell.rowIndex);
		scrollColumnIntoView(cell.columnIndex);
	}

	function scrollToRowInView(rowIndex: number): void {
		if (scrollElement === undefined) {
			return;
		}

		// Rows live below the sticky header (HEADER_HEIGHT), which overlays the top of the viewport,
		// so the unobscured region is [scrollTop, scrollTop + clientHeight - HEADER_HEIGHT] in content
		// space. Compute the comparison and target in content space, then map back to the scroll spacer.
		const rowTop = rowIndex * ROW_HEIGHT;
		const rowBottom = rowTop + ROW_HEIGHT;
		const viewportTop = contentScrollTop();
		const viewportBottom = viewportTop + scrollElement.clientHeight - HEADER_HEIGHT;

		if (rowTop < viewportTop) {
			scrollElement.scrollTop = contentToScroll(rowTop);
		} else if (rowBottom > viewportBottom) {
			scrollElement.scrollTop = contentToScroll(rowBottom - scrollElement.clientHeight + HEADER_HEIGHT);
		}

		setScrollTop(scrollElement.scrollTop);
	}

	function scrollColumnIntoView(columnIndex: number): void {
		if (scrollElement === undefined) {
			return;
		}

		const columnLeft = columnLefts()[columnIndex] ?? ROW_NUMBER_COLUMN_WIDTH;
		const columnRight = columnLeft + getColumnWidth(columnIndex);
		const viewportLeft = scrollElement.scrollLeft + ROW_NUMBER_COLUMN_WIDTH;
		const viewportRight = scrollElement.scrollLeft + scrollElement.clientWidth;

		if (columnLeft < viewportLeft) {
			scrollElement.scrollLeft = Math.max(0, columnLeft - ROW_NUMBER_COLUMN_WIDTH);
		} else if (columnRight > viewportRight) {
			scrollElement.scrollLeft = columnRight - scrollElement.clientWidth;
		}
	}

	return (
		<section class="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] vscode-high-contrast:border-[var(--vscode-focusBorder)]">
			<Show when={props.grid.loadErrorReason()} keyed fallback={
				<Show when={props.grid.virtualRowCount() > 0} fallback={<EmptyState message={props.grid.message()} />}>
					<div
						ref={setScrollContainer}
						role="grid"
						aria-rowcount={props.grid.virtualRowCount()}
						aria-colcount={columnCount()}
						aria-disabled={editingPaused()}
						class="min-h-0 flex-1 overflow-auto outline-none"
						tabIndex={0}
						onFocusIn={handleGridFocusIn}
						onFocusOut={handleGridFocusOut}
						onKeyDown={handleKeyDown}
						onScroll={handleScroll}
					>
						<VirtualTableHeader
							edit={props.edit}
							activeColumnOptionsIndex={columnOptions.panelState()?.columnIndex ?? null}
							columnCount={columnCount()}
							headerCells={props.grid.headerCells()}
							hasRealHeader={props.grid.hasCsvHeader()}
							headerExists={props.grid.headerExists()}
							isFindColumnSelected={columnIndex => props.find.findOpen() && props.find.isFindColumnSelected(columnIndex)}
							onOpenColumnOptions={columnOptions.openColumnOptions}
							onColumnResizeStart={startColumnResize}
							onColumnResizeReset={resetColumnWidth}
							sizing={sizing}
						/>
						<VirtualTableBody
							edit={props.edit}
							activeCell={activeCell()}
							columnCount={columnCount()}
							editingCell={props.edit.editingCell()}
							getCachedRow={props.grid.getCachedRow}
							getCellMatches={props.find.getCellMatches}
							getColumnOptions={columnOptions.getColumnOptions}
							getSourceRowIndex={props.grid.getSourceRowIndex}
							getRowDisplayNumber={props.grid.getRowDisplayNumber}
							isGridFocused={isGridFocused()}
							isActiveMatch={props.find.isActiveCellMatch}
							isActiveMatchCell={props.find.isActiveMatchCell}
							offsetCorrection={offsetCorrection()}
							onActiveCellElement={handleActiveCellElement}
							onContextMenu={openContextMenu}
							rows={visibleRows()}
							sizing={sizing}
							spacerHeight={spacerHeight()}
						/>
					</div>
				</Show>
			}>
				{reason => <LoadErrorState reason={reason} />}
			</Show>
			<Show when={contextMenu()}>
				{menu => (
					<CellContextMenu
						x={menu().x}
						y={menu().y}
						items={contextMenuItems(menu().value)}
						onClose={closeContextMenu}
					/>
				)}
			</Show>
			<Show when={columnOptions.panelState()}>
				{panel => (
					<ColumnOptionsPanel
						state={panel()}
						options={columnOptions.getColumnOptions(panel().columnIndex)}
						headerLabel={columnOptionsHeaderLabel(panel().columnIndex)}
						onTextAlignChange={columnOptions.setColumnTextAlign}
						onTextStyleChange={columnOptions.setColumnTextStyle}
						onForegroundColorChange={columnOptions.setColumnForegroundColor}
						onBackgroundColorChange={columnOptions.setColumnBackgroundColor}
						onReset={columnOptions.resetColumnOptions}
						onClose={closeColumnOptions}
					/>
				)}
			</Show>
			{/* Disabled scrim while a save is materializing the file: dims the grid, swallows pointer input,
			    and states plainly that editing is paused — so the freeze is unmistakable even in edit mode. */}
			<Show when={editingPaused()}>
				<div
					class="absolute inset-0 z-40 flex items-center justify-center"
					style={{ background: 'color-mix(in srgb, var(--vscode-editor-background) 55%, transparent)', cursor: 'not-allowed' }}
					role="status"
					aria-live="polite"
					onPointerDown={event => {
						event.preventDefault();
						event.stopPropagation();
					}}
					onContextMenu={event => event.preventDefault()}
				>
					<div class="flex items-center gap-2 rounded-sm border border-border bg-chrome px-3 py-1.5 shadow-sm">
						<span class="whitespace-nowrap font-mono text-label text-fg">Saving… {props.save.progressPercent()}%</span>
						<span class="text-label text-fg-muted">Editing paused</span>
					</div>
				</div>
			</Show>
		</section>
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
