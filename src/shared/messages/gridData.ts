import type { CsvFileConfigMessage } from './config';
import type { FindMatchMessage } from './find';

export interface StatisticsMessage {
	type: 'statistics';
	rowCount: number;
	readableRowCount: number;
	totalBytesRead: number;
	totalSizeInBytes: number;
	config: CsvFileConfigMessage;
	isFinal: boolean;
}

export interface PageMessage {
	type: 'page';
	offset: number;
	rowCount: number;
	rows: string[][];
	searchSessionId?: string;
	matches?: FindMatchMessage[];
}

export interface RowsMessage {
	type: 'rows';
	requestId: string;
	offset: number;
	rowCount: number;
	rows: string[][];
	rowNumbers?: number[];
	searchSessionId?: string;
	matches?: FindMatchMessage[];
}

export interface RowsUnavailableMessage {
	type: 'rows-unavailable';
	requestId: string;
	offset: number;
	rowCount: number;
	readableRowCount: number;
	isFinal: boolean;
}

export interface HeadersMessage {
	type: 'headers';
	cells: string[];
	config: CsvFileConfigMessage;
	/**
	 * True when `cells` come from a header row *added* to a header-less file (rather than the file's
	 * own first row). The cells keep empty strings for unnamed columns; the webview renders those as
	 * `column_N`. Absent/false means the cells are a real header (or the empty no-header sentinel).
	 */
	headerInserted?: boolean;
}

export interface RequestPageMessage {
	type: 'requestPage';
	offset: number;
	rowCount: number;
}

export interface RequestRowsMessage {
	type: 'requestRows';
	requestId: string;
	offset: number;
	rowCount: number;
	reason: 'viewport' | 'prefetch' | 'ready';
}

export interface LoadedReadyMessage {
	type: 'loaded-ready';
	offset: number;
	rowCount: number;
}
