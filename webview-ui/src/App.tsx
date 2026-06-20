import { onCleanup, onMount } from 'solid-js';
import { createCsvGridController } from './components/csv-data/createCsvGridController';
import { createEditController } from './components/editing/createEditController';
import { createFindController } from './components/find/createFindController';
import { createWebviewMessageBridge } from './components/messaging/createWebviewMessageBridge';
import { createSaveController } from './components/saving/createSaveController';
import { createExportController } from './components/toolbar/createExportController';
import { createQueryController } from './components/toolbar/query/createQueryController';
import { Toolbar } from './components/toolbar/Toolbar';
import { createColumnOptionsController } from './components/virtual-table/createColumnOptionsController';
import { VirtualTable } from './components/virtual-table/VirtualTable';

export function App() {
	const grid = createCsvGridController();
	const find = createFindController({
		scrollToSourceRow: grid.scrollToSourceRow,
		scrollToSourceCell: grid.scrollToSourceCell,
		getCursor: grid.cursorLocation,
		getVisibleRange: grid.visibleRange,
		refreshRows: grid.refreshRows,
		focusGrid: grid.focusGrid,
		onFilterRowsReceived: (message) => grid.applyFilterUpdate(message),
		onFilterClear: () => grid.clearFilterCache()
	});
	const edit = createEditController(grid);
	const save = createSaveController();
	// Column display options (alignment + colors) are lifted here so both the grid that edits them and
	// the export controller that retains them in styled exports share one source of truth.
	const columnOptions = createColumnOptionsController();
	const exportController = createExportController({ grid, find, getColumnDisplayOptions: columnOptions.getColumnOptions });
	const toolsController = createQueryController(grid);

	createWebviewMessageBridge({ grid, find, edit, save, export: exportController, tools: toolsController });

	// Cursor navigation lives on the grid container's keydown, so it only fires while focus is inside the
	// grid. Listen at the document level so the table stays navigable once focus moves out of the grid —
	// a toolbar button, or <body> when nothing is focused (the disclosure tabs preventDefault mousedown,
	// so clicking them leaves focus on <body>). Those keydowns bubble up past <main> to the document but
	// never *down* into it, so a handler on <main> would miss them. Keys whose focus is already inside the
	// grid are left to the grid's own handler; everything else is forwarded into the table's cursor logic.
	onMount(() => {
		const forwardNavigationKey = (event: KeyboardEvent): void => {
			if (!NAVIGATION_KEYS.has(event.key)) {
				return; // only the cursor-navigation set — never Tab (focus traversal) or printable keys
			}

			if (isEditableTarget(event.target)) {
				return; // a text field / select needs these keys for its own caret or option navigation
			}

			if (event.target instanceof Element && event.target.closest('[role="grid"]') !== null) {
				return; // focus is inside the grid — its own onKeyDown handles (and stopPropagation's) this
			}

			grid.handleGridNavigationKey(event);
		};

		document.addEventListener('keydown', forwardNavigationKey);
		onCleanup(() => document.removeEventListener('keydown', forwardNavigationKey));
	});

	return (
		<main class="flex h-screen min-h-0 flex-col gap-3 bg-[var(--vscode-editor-background)] p-4 text-[var(--vscode-foreground)]">
			<Toolbar grid={grid} find={find} edit={edit} save={save} export={exportController} tools={toolsController} />
			<VirtualTable grid={grid} find={find} edit={edit} save={save} columnOptions={columnOptions} />
		</main>
	);
}

const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

/** Controls that own the navigation keys themselves: text fields, selects, and contenteditable. */
function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	const tag = target.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
