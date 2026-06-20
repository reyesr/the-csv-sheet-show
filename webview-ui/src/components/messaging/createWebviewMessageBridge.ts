import { onCleanup, onMount } from 'solid-js';
import type { ExtensionToWebviewMessage } from '../../../../src/shared/messages/protocol';
import type { CsvGridController, EditController, FindController, SaveController } from '../../types';
import type { ExportController } from '../toolbar/createExportController';
import type { QueryController } from '../toolbar/query/createQueryController';
import { postMessage } from '../../vscode';
import { applyRememberedSnapshot } from '../../remembered';

export function createWebviewMessageBridge(input: {
	grid: CsvGridController;
	find: FindController;
	edit: EditController;
	save: SaveController;
	export: ExportController;
	tools: QueryController;
}): void {
	onMount(() => {
		const onMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
			const message = event.data;
			input.grid.setLastEvent(message.type);

			if (message.type === 'rememberedState') {
				applyRememberedSnapshot(message);
				return;
			}

			if (message.type === 'statistics') {
				input.grid.handleStatistics(message);
				return;
			}

			if (message.type === 'page') {
				input.grid.handlePage(message);
				if (message.matches !== undefined) {
					input.find.handleSearchMatches(message.searchSessionId, { startRowIndex: message.offset, endRowIndex: message.offset + message.rowCount - 1 }, message.matches);
				}
				return;
			}

			if (message.type === 'rows') {
				input.grid.handleRows(message);
				if (message.matches !== undefined) {
					input.find.handleSearchMatches(message.searchSessionId, { startRowIndex: message.offset, endRowIndex: message.offset + message.rowCount - 1 }, message.matches);
				}
				return;
			}

			if (message.type === 'rows-unavailable') {
				input.grid.handleRowsUnavailable(message);
				return;
			}

			if (message.type === 'headers') {
				input.grid.handleHeaders(message);
				return;
			}

			if (message.type === 'searchMatches') {
				input.find.handleSearchMatches(message.searchSessionId, message.range, message.matches);
				return;
			}

			if (message.type === 'searchCursor') {
				input.find.handleSearchCursor(message.searchSessionId, message.match, message.wrapped);
				return;
			}

			if (message.type === 'searchStatus') {
				input.find.handleSearchStatus(message);
				return;
			}

			if (message.type === 'searchClear') {
				input.find.handleSearchClear(message.searchSessionId);
				return;
			}

			if (message.type === 'findUpdate') {
				input.find.handleFindUpdate(message);
				return;
			}

			if (message.type === 'findUpdateClear') {
				input.find.handleFindUpdateClear(message);
				return;
			}

			if (message.type === 'showFind') {
				input.find.showFindBar();
				return;
			}

			if (message.type === 'findNext') {
				if (!input.find.findOpen()) {
					input.find.showFindBar();
				} else {
					input.find.navigateFindMatch(1);
				}
				return;
			}

			if (message.type === 'findPrevious') {
				if (!input.find.findOpen()) {
					input.find.showFindBar();
				} else {
					input.find.navigateFindMatch(-1);
				}
				return;
			}

			if (message.type === 'closeFind') {
				input.find.closeFindBar();
				return;
			}

			if (message.type === 'editMode') {
				input.edit.handleEditMode(message.isEditable);
				return;
			}

			if (message.type === 'changeApplied') {
				input.edit.handleChangeApplied(message);
				return;
			}

			if (message.type === 'changeRejected') {
				input.edit.handleChangeRejected(message);
				return;
			}

			if (message.type === 'saveStarted') {
				input.save.handleSaveStarted();
				return;
			}

			if (message.type === 'saveProgress') {
				input.save.handleSaveProgress(message.percent);
				return;
			}

			if (message.type === 'saveComplete') {
				input.save.handleSaveComplete();
				return;
			}

			if (message.type === 'exportCapabilities') {
				input.export.handleCapabilities(message);
				return;
			}

			if (message.type === 'exportProgress') {
				input.export.handleProgress(message);
				return;
			}

			if (message.type === 'exportComplete') {
				input.export.handleComplete(message);
				return;
			}

			if (message.type === 'exportError') {
				input.export.handleError(message);
				return;
			}

			if (message.type === 'duckDbStatus') {
				input.tools.handleDuckDbStatus(message);
				return;
			}

			if (message.type === 'error') {
				input.grid.handleError(message.reason);
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			const key = event.key.toLocaleLowerCase();
			const primaryModifier = event.ctrlKey || event.metaKey;

			if (primaryModifier && key === 'f') {
				event.preventDefault();
				event.stopPropagation();
				input.find.showFindBar();
				return;
			}

			if (event.key === 'F3') {
				event.preventDefault();
				event.stopPropagation();
				if (!input.find.findOpen()) {
					input.find.showFindBar();
				} else {
					input.find.navigateFindMatch(event.shiftKey ? -1 : 1);
				}
				return;
			}

			if (primaryModifier && key === 'g') {
				event.preventDefault();
				event.stopPropagation();
				if (!input.find.findOpen()) {
					input.find.showFindBar();
				} else {
					input.find.navigateFindMatch(event.shiftKey ? -1 : 1);
				}
			}
		};

		window.addEventListener('message', onMessage);
		window.addEventListener('keydown', onKeyDown, { capture: true });
		input.grid.markInitialBlockInFlight();
		postMessage({
			type: 'loaded-ready',
			offset: input.grid.offset(),
			rowCount: input.grid.rowCount()
		});
		onCleanup(() => window.removeEventListener('message', onMessage));
		onCleanup(() => window.removeEventListener('keydown', onKeyDown, { capture: true }));
		onCleanup(() => input.find.cancelCurrentFind());
	});
}
