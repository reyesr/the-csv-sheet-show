/// <reference types="mocha" />
import * as assert from 'assert';
import { DecimalSeparator } from '../../csv/DataTypes';
import { createJsonEncoder, jsonString } from '../../export/encoders/json';
import { createFieldFormatter } from '../../export/fieldFormatter';
import type { ExportColumn, ExportContext } from '../../export/types';

function numberCol(sourceIndex: number, name: string): ExportColumn {
	return { sourceIndex, name, typeId: 'number', kind: 'numeric' };
}

function textCol(sourceIndex: number, name: string): ExportColumn {
	return { sourceIndex, name, typeId: 'text', kind: 'text' };
}

/** Drive the JSON encoder over `rows` exactly as ExportService does, returning the full output. */
function runJson(
	columns: ExportColumn[],
	rows: string[][],
	formatOptions: Record<string, unknown>,
	decimalSeparator: DecimalSeparator = DecimalSeparator.BOTH
): string {
	const context: ExportContext = {
		columns,
		hasHeader: true,
		rowCount: rows.length,
		formatOptions,
		formatField: createFieldFormatter(columns, decimalSeparator)
	};
	const encoder = createJsonEncoder();
	let output = encoder.begin(context);
	rows.forEach((row, index) => {
		output += encoder.encodeRow(columns.map(column => row[column.sourceIndex] ?? ''), index, context);
	});
	return output + encoder.end(context);
}

suite('JSON export encoder', () => {
	const columns = [numberCol(0, 'id'), textCol(1, 'name'), numberCol(2, 'price')];
	const rows = [['1', 'CafÃ©', '1,5'], ['2', 'Tea', '']];

	test('objects shape, pretty, comma-decimal normalization, empty â†’ null', () => {
		const output = runJson(columns, rows, { shape: 'objects', indent: 2, emptyAs: 'null', keyStyle: 'header' });
		assert.strictEqual(output,
			'[\n'
			+ '  { "id": 1, "name": "CafÃ©", "price": 1.5 },\n'
			+ '  { "id": 2, "name": "Tea", "price": null }\n'
			+ ']\n');
		assert.deepStrictEqual(JSON.parse(output), [
			{ id: 1, name: 'CafÃ©', price: 1.5 },
			{ id: 2, name: 'Tea', price: null }
		]);
	});

	test('arrays shape with header row, minified', () => {
		const output = runJson(columns, rows, { shape: 'arrays', indent: 0, includeHeaderRow: true, emptyAs: 'null', keyStyle: 'header' });
		assert.strictEqual(output, '[["id","name","price"],[1,"CafÃ©",1.5],[2,"Tea",null]]\n');
	});

	test('ndjson shape, omit empty keys', () => {
		const output = runJson(columns, rows, { shape: 'ndjson', emptyAs: 'omit', keyStyle: 'header' });
		assert.strictEqual(output, '{"id":1,"name":"CafÃ©","price":1.5}\n{"id":2,"name":"Tea"}\n');
	});

	test('typing off (all text) emits every value as a string', () => {
		const textColumns = [textCol(0, 'id'), textCol(1, 'name'), textCol(2, 'price')];
		const output = runJson(textColumns, [['1', 'Tea', '1,5']], { shape: 'objects', indent: 0, emptyAs: 'null', keyStyle: 'header' });
		assert.strictEqual(output, '[{"id":"1","name":"Tea","price":"1,5"}]\n');
	});

	test('non-numeric cell in a number column falls back to a string', () => {
		const output = runJson([numberCol(0, 'v')], [['abc']], { shape: 'objects', indent: 0, emptyAs: 'null', keyStyle: 'header' });
		assert.strictEqual(output, '[{"v":"abc"}]\n');
	});

	test('huge integers are emitted as strings to preserve exactness', () => {
		const output = runJson([numberCol(0, 'id')], [['1234567890123456']], { shape: 'objects', indent: 0, emptyAs: 'null', keyStyle: 'header' });
		assert.strictEqual(output, '[{"id":"1234567890123456"}]\n');
	});

	test('duplicate column names get numeric suffixes', () => {
		const output = runJson([textCol(0, 'a'), textCol(1, 'a')], [['x', 'y']], { shape: 'objects', indent: 0, emptyAs: 'null', keyStyle: 'header' });
		assert.strictEqual(output, '[{"a":"x","a_2":"y"}]\n');
	});

	test('empty / missing column names synthesize column_N keys', () => {
		const output = runJson([textCol(0, ''), textCol(2, '')], [['x', 'skip', 'z']], { shape: 'objects', indent: 0, emptyAs: 'null', keyStyle: 'header' });
		assert.strictEqual(output, '[{"column_1":"x","column_3":"z"}]\n');
	});

	test('keyStyle camelCase / snake_case transform header names', () => {
		const camel = runJson([textCol(0, 'First Name')], [['x']], { shape: 'objects', indent: 0, emptyAs: 'null', keyStyle: 'camelCase' });
		assert.strictEqual(camel, '[{"firstName":"x"}]\n');
		const snake = runJson([textCol(0, 'First Name')], [['x']], { shape: 'objects', indent: 0, emptyAs: 'null', keyStyle: 'snake_case' });
		assert.strictEqual(snake, '[{"first_name":"x"}]\n');
	});

	test('empty dataset produces an empty array', () => {
		assert.strictEqual(runJson([textCol(0, 'a')], [], { shape: 'objects', indent: 2, emptyAs: 'null', keyStyle: 'header' }), '[]\n');
		assert.strictEqual(runJson([textCol(0, 'a')], [], { shape: 'ndjson', emptyAs: 'null', keyStyle: 'header' }), '');
	});

	test('emptyAs empty-string', () => {
		const output = runJson([textCol(0, 'a'), textCol(1, 'b')], [['', 'y']], { shape: 'objects', indent: 0, emptyAs: 'empty-string', keyStyle: 'header' });
		assert.strictEqual(output, '[{"a":"","b":"y"}]\n');
	});
});

suite('JSON string escaping', () => {
	test('escapes quotes, backslashes, control chars; leaves unicode verbatim', () => {
		assert.strictEqual(jsonString('a"b\\c'), '"a\\"b\\\\c"');
		assert.strictEqual(jsonString('line1\nline2\tend'), '"line1\\nline2\\tend"');
		assert.strictEqual(jsonString(String.fromCharCode(1)), '"\\u0001"');
		assert.strictEqual(jsonString('CafÃ© â€” â˜•'), '"CafÃ© â€” â˜•"');
	});
});
