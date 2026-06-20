import type {
	StatisticsMessage,
	PageMessage,
	RowsMessage,
	RowsUnavailableMessage,
	HeadersMessage,
	RequestPageMessage,
	RequestRowsMessage,
	LoadedReadyMessage
} from './gridData';
import type {
	SearchMatchesMessage,
	SearchCursorMessage,
	SearchStatusMessage,
	SearchClearMessage,
	FindUpdateMessage,
	FindUpdateClearMessage,
	ShowFindMessage,
	FindNextMessage,
	FindPreviousMessage,
	CloseFindMessage,
	FindRequestMessage
} from './find';
import type {
	EditModeMessage,
	ChangeAppliedMessage,
	ChangeRejectedMessage,
	SetCellContentMessage,
	InsertRowMessage,
	DeleteRowRangeMessage,
	SetHeaderContentMessage,
	AddHeaderRowMessage,
	SetEditModeMessage
} from './editing';
import type { SetCsvConfigMessage } from './config';
import type { ErrorMessage } from './errors';
import type { SaveStartedMessage, SaveProgressMessage, SaveCompleteMessage } from './save';
import type {
	ExportRequestMessage,
	ExportProgressMessage,
	ExportCompleteMessage,
	ExportErrorMessage,
	ExportCapabilitiesMessage
} from './export';
import type { CheckDuckDbRequestMessage, DuckDbStatusMessage, RunDuckDbRequestMessage } from './duckdb';
import type { SetMemoryMessage, RememberedStateMessage } from './memory';

export interface WebviewLogMessage {
	type: 'log';
	level: string;
	message: string;
	data?: unknown;
}

/**
 * The two directions of the webview protocol, and the single source of truth for which way a message
 * travels. The webview's send/receive boundaries (`vscode.ts`, `createWebviewMessageBridge.ts`) and
 * the extension's post paths (`PanelBroadcaster`, `ActivePanelTracker`, the host ports) are all typed
 * by these unions, so direction is enforced by the compiler rather than encoded in each message name.
 *
 * Naming heuristic the messages follow:
 * - webview → extension are imperative commands: `Set*`, `Insert*`, `Delete*`, `*Request*`,
 *   `RequestPage`/`RequestRows`, `LoadedReady`.
 * - extension → webview are state/notifications: `Statistics`, `Page`, `Rows`, `Headers`, `*Applied`,
 *   `*Progress`, `Error`.
 * Exceptions: `ShowFind`/`FindNext`/`FindPrevious`/`CloseFind` are extension → webview commands — the
 * extension driving the webview from VS Code keybindings, dispatched via `ActivePanelTracker`.
 */
export type ExtensionToWebviewMessage = StatisticsMessage | PageMessage | RowsMessage | RowsUnavailableMessage | HeadersMessage | SearchMatchesMessage | SearchCursorMessage | SearchStatusMessage | SearchClearMessage | FindUpdateMessage | FindUpdateClearMessage | ShowFindMessage | FindNextMessage | FindPreviousMessage | CloseFindMessage | ErrorMessage | EditModeMessage | ChangeAppliedMessage | ChangeRejectedMessage | SaveStartedMessage | SaveProgressMessage | SaveCompleteMessage | ExportProgressMessage | ExportCompleteMessage | ExportErrorMessage | ExportCapabilitiesMessage | RememberedStateMessage | DuckDbStatusMessage;

export type WebviewToExtensionMessage = RequestPageMessage | RequestRowsMessage | LoadedReadyMessage | FindRequestMessage | WebviewLogMessage | SetCellContentMessage | InsertRowMessage | DeleteRowRangeMessage | SetHeaderContentMessage | AddHeaderRowMessage | SetEditModeMessage | SetCsvConfigMessage | ExportRequestMessage | CheckDuckDbRequestMessage | RunDuckDbRequestMessage | SetMemoryMessage;
