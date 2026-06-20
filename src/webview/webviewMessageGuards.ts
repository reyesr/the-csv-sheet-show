import type {
	AddHeaderRowMessage,
	DeleteRowRangeMessage,
	InsertRowMessage,
	SetCellContentMessage,
	SetEditModeMessage,
	SetHeaderContentMessage
} from '../shared/messages/editing';
import type { ExportRequestMessage } from '../shared/messages/export';
import type { CheckDuckDbRequestMessage, RunDuckDbRequestMessage } from '../shared/messages/duckdb';
import type { FindRequestMessage } from '../shared/messages/find';
import type { LoadedReadyMessage, RequestPageMessage, RequestRowsMessage } from '../shared/messages/gridData';
import type { SetCsvConfigMessage } from '../shared/messages/config';
import type { SetMemoryMessage } from '../shared/messages/memory';
import type { WebviewLogMessage } from '../shared/messages/protocol';

export function isWebviewLogMessage(message: unknown): message is WebviewLogMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as { type?: unknown; level?: unknown; message?: unknown };
	return candidate.type === 'log'
		&& typeof candidate.level === 'string'
		&& typeof candidate.message === 'string';
}

export function isLoadedReadyMessage(message: unknown): message is LoadedReadyMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as { type?: unknown; offset?: unknown; rowCount?: unknown };
	return candidate.type === 'loaded-ready'
		&& typeof candidate.offset === 'number'
		&& typeof candidate.rowCount === 'number';
}

export function isRequestRowsMessage(message: unknown): message is RequestRowsMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as { type?: unknown; requestId?: unknown; offset?: unknown; rowCount?: unknown; reason?: unknown };
	return candidate.type === 'requestRows'
		&& typeof candidate.requestId === 'string'
		&& typeof candidate.offset === 'number'
		&& typeof candidate.rowCount === 'number'
		&& (candidate.reason === 'viewport' || candidate.reason === 'prefetch' || candidate.reason === 'ready');
}

export function isFindRequestMessage(message: unknown): message is FindRequestMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as {
		type?: unknown;
		searchSessionId?: unknown;
		action?: unknown;
		query?: unknown;
		options?: { matchCase?: unknown; wholeWord?: unknown; regex?: unknown };
		cursor?: { rowIndex?: unknown; cellIndex?: unknown; charOffset?: unknown };
		visibleRange?: { startRowIndex?: unknown; endRowIndex?: unknown };
	};
	return candidate.type === 'findRequest'
		&& typeof candidate.searchSessionId === 'string'
		&& (candidate.action === 'open' || candidate.action === 'update' || candidate.action === 'next' || candidate.action === 'previous' || candidate.action === 'close')
		&& typeof candidate.query === 'string'
		&& typeof candidate.options === 'object'
		&& candidate.options !== null
		&& typeof candidate.options.matchCase === 'boolean'
		&& typeof candidate.options.wholeWord === 'boolean'
		&& typeof candidate.options.regex === 'boolean'
		&& typeof candidate.cursor === 'object'
		&& candidate.cursor !== null
		&& typeof candidate.cursor.rowIndex === 'number'
		&& typeof candidate.cursor.cellIndex === 'number'
		&& typeof candidate.cursor.charOffset === 'number'
		&& typeof candidate.visibleRange === 'object'
		&& candidate.visibleRange !== null
		&& typeof candidate.visibleRange.startRowIndex === 'number'
		&& typeof candidate.visibleRange.endRowIndex === 'number';
}

export function isSetEditModeMessage(message: unknown): message is SetEditModeMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as { type?: unknown; editable?: unknown };
	return candidate.type === 'setEditMode' && typeof candidate.editable === 'boolean';
}

export function isSetCellContentMessage(message: unknown): message is SetCellContentMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as { type?: unknown; requestId?: unknown; rowIndex?: unknown; columnIndex?: unknown; value?: unknown };
	return candidate.type === 'setCellContent'
		&& typeof candidate.requestId === 'string'
		&& typeof candidate.rowIndex === 'number'
		&& typeof candidate.columnIndex === 'number'
		&& typeof candidate.value === 'string';
}

export function isSetHeaderContentMessage(message: unknown): message is SetHeaderContentMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as { type?: unknown; requestId?: unknown; columnIndex?: unknown; value?: unknown };
	return candidate.type === 'setHeaderContent'
		&& typeof candidate.requestId === 'string'
		&& typeof candidate.columnIndex === 'number'
		&& typeof candidate.value === 'string';
}

export function isAddHeaderRowMessage(message: unknown): message is AddHeaderRowMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as { type?: unknown; requestId?: unknown; columnCount?: unknown };
	return candidate.type === 'addHeaderRow'
		&& typeof candidate.requestId === 'string'
		&& typeof candidate.columnCount === 'number';
}

export function isInsertRowMessage(message: unknown): message is InsertRowMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as { type?: unknown; requestId?: unknown; rowIndex?: unknown };
	return candidate.type === 'insertRow'
		&& typeof candidate.requestId === 'string'
		&& typeof candidate.rowIndex === 'number';
}

export function isDeleteRowRangeMessage(message: unknown): message is DeleteRowRangeMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as { type?: unknown; requestId?: unknown; offset?: unknown; count?: unknown };
	return candidate.type === 'deleteRowRange'
		&& typeof candidate.requestId === 'string'
		&& typeof candidate.offset === 'number'
		&& typeof candidate.count === 'number';
}

export function isSetCsvConfigMessage(message: unknown): message is SetCsvConfigMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as { type?: unknown; separator?: unknown; encoding?: unknown; lineEnding?: unknown; hasHeader?: unknown };
	return candidate.type === 'setCsvConfig'
		&& typeof candidate.separator === 'string'
		&& typeof candidate.encoding === 'string'
		&& typeof candidate.lineEnding === 'string'
		&& typeof candidate.hasHeader === 'boolean';
}

export function isSetMemoryMessage(message: unknown): message is SetMemoryMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as { type?: unknown; scope?: unknown; key?: unknown };
	return candidate.type === 'setMemory'
		&& (candidate.scope === 'global' || candidate.scope === 'file')
		&& typeof candidate.key === 'string';
}

export function isExportRequestMessage(message: unknown): message is ExportRequestMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as {
		type?: unknown; requestId?: unknown; format?: unknown; destination?: unknown;
		columns?: unknown; scope?: unknown; formatOptions?: unknown;
	};
	return candidate.type === 'exportRequest'
		&& typeof candidate.requestId === 'string'
		&& typeof candidate.format === 'string'
		&& (candidate.destination === 'file' || candidate.destination === 'clipboard')
		&& Array.isArray(candidate.columns)
		&& (candidate.scope === 'all' || candidate.scope === 'filtered')
		&& typeof candidate.formatOptions === 'object'
		&& candidate.formatOptions !== null;
}

export function isCheckDuckDbRequestMessage(message: unknown): message is CheckDuckDbRequestMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as { type?: unknown };
	return candidate.type === 'checkDuckDb';
}

export function isRunDuckDbRequestMessage(message: unknown): message is RunDuckDbRequestMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as { type?: unknown; requestId?: unknown; tableKind?: unknown; tableName?: unknown; decimalSeparator?: unknown };
	return candidate.type === 'runDuckDb'
		&& typeof candidate.requestId === 'string'
		&& (candidate.tableKind === 'table' || candidate.tableKind === 'view')
		&& typeof candidate.tableName === 'string'
		&& (candidate.decimalSeparator === '.' || candidate.decimalSeparator === ',');
}

export function isPageRequest(message: unknown): message is RequestPageMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as { type?: unknown; offset?: unknown; rowCount?: unknown };
	return candidate.type === 'requestPage'
		&& typeof candidate.offset === 'number'
		&& typeof candidate.rowCount === 'number';
}

export function formatLogData(data: unknown): string {
	if (data === undefined) {
		return '';
	}

	return ` ${safeStringify(data)}`;
}

export function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return '[unserializable]';
	}
}
