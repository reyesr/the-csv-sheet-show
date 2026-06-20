/// <reference types="mocha" />
import * as assert from 'assert';
import {
	formatLogData,
	isCheckDuckDbRequestMessage,
	isDeleteRowRangeMessage,
	isFindRequestMessage,
	isInsertRowMessage,
	isLoadedReadyMessage,
	isPageRequest,
	isRequestRowsMessage,
	isRunDuckDbRequestMessage,
	isSetCellContentMessage,
	isSetCsvConfigMessage,
	isSetEditModeMessage,
	isSetHeaderContentMessage,
	isWebviewLogMessage,
	safeStringify
} from '../../webview/webviewMessageGuards';

suite('webviewMessageGuards', () => {
	test('rejects non-objects and null for every guard', () => {
		for (const guard of [
			isWebviewLogMessage, isLoadedReadyMessage, isRequestRowsMessage, isFindRequestMessage,
			isSetEditModeMessage, isSetCellContentMessage, isSetHeaderContentMessage, isInsertRowMessage,
			isDeleteRowRangeMessage, isSetCsvConfigMessage, isCheckDuckDbRequestMessage, isRunDuckDbRequestMessage, isPageRequest
		]) {
			assert.strictEqual(guard(null), false);
			assert.strictEqual(guard(undefined), false);
			assert.strictEqual(guard('requestPage'), false);
			assert.strictEqual(guard(42), false);
			assert.strictEqual(guard({ type: 'somethingElse' }), false);
		}
	});

	test('isWebviewLogMessage', () => {
		assert.strictEqual(isWebviewLogMessage({ type: 'log', level: 'info', message: 'hi' }), true);
		assert.strictEqual(isWebviewLogMessage({ type: 'log', level: 'info' }), false);
		assert.strictEqual(isWebviewLogMessage({ type: 'log', level: 1, message: 'hi' }), false);
	});

	test('isLoadedReadyMessage', () => {
		assert.strictEqual(isLoadedReadyMessage({ type: 'loaded-ready', offset: 0, rowCount: 10 }), true);
		assert.strictEqual(isLoadedReadyMessage({ type: 'loaded-ready', offset: '0', rowCount: 10 }), false);
	});

	test('isRequestRowsMessage validates reason enum', () => {
		assert.strictEqual(isRequestRowsMessage({ type: 'requestRows', requestId: 'r1', offset: 0, rowCount: 5, reason: 'viewport' }), true);
		assert.strictEqual(isRequestRowsMessage({ type: 'requestRows', requestId: 'r1', offset: 0, rowCount: 5, reason: 'prefetch' }), true);
		assert.strictEqual(isRequestRowsMessage({ type: 'requestRows', requestId: 'r1', offset: 0, rowCount: 5, reason: 'ready' }), true);
		assert.strictEqual(isRequestRowsMessage({ type: 'requestRows', requestId: 'r1', offset: 0, rowCount: 5, reason: 'bogus' }), false);
		assert.strictEqual(isRequestRowsMessage({ type: 'requestRows', requestId: 7, offset: 0, rowCount: 5, reason: 'viewport' }), false);
	});

	test('isFindRequestMessage requires nested options/cursor/visibleRange', () => {
		const valid = {
			type: 'findRequest',
			searchSessionId: 's1',
			action: 'update',
			query: 'abc',
			options: { matchCase: false, wholeWord: false, regex: true },
			cursor: { rowIndex: 0, cellIndex: 0, charOffset: 0 },
			visibleRange: { startRowIndex: 0, endRowIndex: 10 }
		};
		assert.strictEqual(isFindRequestMessage(valid), true);
		assert.strictEqual(isFindRequestMessage({ ...valid, action: 'bogus' }), false);
		assert.strictEqual(isFindRequestMessage({ ...valid, options: { matchCase: false, wholeWord: false } }), false);
		assert.strictEqual(isFindRequestMessage({ ...valid, cursor: null }), false);
		assert.strictEqual(isFindRequestMessage({ ...valid, visibleRange: { startRowIndex: 0 } }), false);
	});

	test('isSetEditModeMessage', () => {
		assert.strictEqual(isSetEditModeMessage({ type: 'setEditMode', editable: true }), true);
		assert.strictEqual(isSetEditModeMessage({ type: 'setEditMode', editable: 'yes' }), false);
	});

	test('isSetCellContentMessage', () => {
		assert.strictEqual(isSetCellContentMessage({ type: 'setCellContent', requestId: 'r', rowIndex: 1, columnIndex: 2, value: 'v' }), true);
		assert.strictEqual(isSetCellContentMessage({ type: 'setCellContent', requestId: 'r', rowIndex: 1, columnIndex: 2 }), false);
	});

	test('isSetHeaderContentMessage', () => {
		assert.strictEqual(isSetHeaderContentMessage({ type: 'setHeaderContent', requestId: 'r', columnIndex: 0, value: 'h' }), true);
		assert.strictEqual(isSetHeaderContentMessage({ type: 'setHeaderContent', requestId: 'r', columnIndex: '0', value: 'h' }), false);
	});

	test('isInsertRowMessage', () => {
		assert.strictEqual(isInsertRowMessage({ type: 'insertRow', requestId: 'r', rowIndex: 3 }), true);
		assert.strictEqual(isInsertRowMessage({ type: 'insertRow', requestId: 'r' }), false);
	});

	test('isDeleteRowRangeMessage', () => {
		assert.strictEqual(isDeleteRowRangeMessage({ type: 'deleteRowRange', requestId: 'r', offset: 0, count: 2 }), true);
		assert.strictEqual(isDeleteRowRangeMessage({ type: 'deleteRowRange', requestId: 'r', offset: 0 }), false);
	});

	test('isSetCsvConfigMessage', () => {
		assert.strictEqual(isSetCsvConfigMessage({ type: 'setCsvConfig', separator: ',', encoding: 'utf8', lineEnding: '\n', hasHeader: true }), true);
		assert.strictEqual(isSetCsvConfigMessage({ type: 'setCsvConfig', separator: ',', encoding: 'utf8', lineEnding: '\n', hasHeader: 'true' }), false);
	});

	test('isCheckDuckDbRequestMessage', () => {
		assert.strictEqual(isCheckDuckDbRequestMessage({ type: 'checkDuckDb' }), true);
		assert.strictEqual(isCheckDuckDbRequestMessage({ type: 'checkDuckDbStatus' }), false);
	});

	test('isRunDuckDbRequestMessage validates tableKind and decimalSeparator enums', () => {
		const valid = { type: 'runDuckDb', requestId: 'd1', tableKind: 'table', tableName: 'data', decimalSeparator: '.' };
		assert.strictEqual(isRunDuckDbRequestMessage(valid), true);
		assert.strictEqual(isRunDuckDbRequestMessage({ ...valid, tableKind: 'view', decimalSeparator: ',' }), true);
		// Missing the decimal separator (the pre-existing shape) is now rejected.
		assert.strictEqual(isRunDuckDbRequestMessage({ type: 'runDuckDb', requestId: 'd1', tableKind: 'table', tableName: 'data' }), false);
		assert.strictEqual(isRunDuckDbRequestMessage({ ...valid, decimalSeparator: ';' }), false);
		assert.strictEqual(isRunDuckDbRequestMessage({ ...valid, decimalSeparator: 0 }), false);
		assert.strictEqual(isRunDuckDbRequestMessage({ ...valid, tableKind: 'materialized' }), false);
		assert.strictEqual(isRunDuckDbRequestMessage({ ...valid, requestId: 1 }), false);
		assert.strictEqual(isRunDuckDbRequestMessage({ ...valid, tableName: 42 }), false);
	});

	test('isPageRequest', () => {
		assert.strictEqual(isPageRequest({ type: 'requestPage', offset: 0, rowCount: 100 }), true);
		assert.strictEqual(isPageRequest({ type: 'requestPage', offset: 0 }), false);
	});

	test('safeStringify handles plain and circular values', () => {
		assert.strictEqual(safeStringify({ a: 1 }), '{"a":1}');
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		assert.strictEqual(safeStringify(circular), '[unserializable]');
	});

	test('formatLogData prefixes a space and is empty for undefined', () => {
		assert.strictEqual(formatLogData(undefined), '');
		assert.strictEqual(formatLogData({ a: 1 }), ' {"a":1}');
	});
});
