import type * as vscode from 'vscode';
import type { CsvFileConfig } from '../csv/CsvFileConfig';
import type { CsvMappingReader } from '../io/CsvMappingReader';
import type { CsvSearchReader } from '../io/CsvSearchReader';
import type { ExtensionToWebviewMessage } from '../shared/messages/protocol';
import type { FindCursorLocation, FindMatchMessage, FindOptionsMessage, FindVisibleRange } from '../shared/messages/find';

/** Per-panel state of a find/filter session. */
export interface SearchState {
	searchSessionId: string;
	query: string;
	options: FindOptionsMessage;
	cursor: FindCursorLocation;
	visibleRange: FindVisibleRange;
	filterMode: boolean;
	/** Active streaming filter search; owns matchingRows + cancellation. Null in navigate mode or for an empty filter query. */
	searchReader: CsvSearchReader | null;
}

/** A located match plus the page it was found in — the result of a navigation scan. */
export interface NavigationResult {
	match: FindMatchMessage;
	wrapped: boolean;
	range: FindVisibleRange;
	matches: FindMatchMessage[];
}

/** A block of displayed rows. Find caches a page's match results keyed by this object's identity. */
export interface RowPage {
	offset: number;
	rowCount: number;
	rows: string[][];
}

/**
 * Outcome of resolving a filtered page, computed without touching the webview so the controller owns
 * all message posting. `rowCount` is echoed back for the unavailable reply.
 */
export type FilteredPageResult =
	| { kind: 'unavailable'; offset: number; rowCount: number; readableRowCount: number; isFinal: boolean }
	| { kind: 'rows'; offset: number; rows: string[][]; rowNumbers: number[]; searchSessionId?: string; matches?: FindMatchMessage[] };

/**
 * The slice of the host document the find subsystem depends on (a Dependency-Inversion port): row
 * reading, range-capability checks, paging-cache access and message posting. This keeps find decoupled
 * from CsvDocument's editing/saving/paging concerns — find only knows it can read rows and post results.
 */
export interface FindHost {
	readonly reader: CsvMappingReader;
	/** Block size used when scanning the file in navigate mode (mirrors the paging block). */
	readonly pageSize: number;
	/** Read displayed (header-excluded, edit-applied) rows; `[]` when configuration is not yet available. */
	readVirtualRows(offset: number, rowCount: number): string[][];
	/** Read displayed rows guarded by `canReadDisplayedRange`; `[]` when that range is not currently readable. */
	readDisplayedRows(offset: number, rowCount: number): string[][];
	canReadDisplayedRange(offset: number, rowCount: number): boolean;
	getDisplayedReadableRowCount(): number;
	getConfig(): CsvFileConfig | null;
	/** A per-panel cached page (shared with the paging path) covering the given range. */
	getCachedPage(offset: number, rowCount: number, panel: vscode.WebviewPanel): RowPage;
	/** True once indexing of the file is final (the whole row count is known). */
	isIndexingFinal(): boolean;
	isDisposed(): boolean;
	post(message: ExtensionToWebviewMessage, panel?: vscode.WebviewPanel): void;
}
