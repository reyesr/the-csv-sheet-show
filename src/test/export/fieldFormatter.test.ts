/// <reference types="mocha" />
import * as assert from 'assert';
import { DecimalSeparator } from '../../csv/DataTypes';
import { createFieldFormatter } from '../../export/fieldFormatter';
import type { ExportColumn } from '../../export/types';

const numeric: ExportColumn = { sourceIndex: 0, name: 'n', typeId: 'number', kind: 'numeric' };
const text: ExportColumn = { sourceIndex: 0, name: 't', typeId: 'text', kind: 'text' };
const boolean: ExportColumn = { sourceIndex: 0, name: 'b', typeId: 'bool', kind: 'boolean' };
const date: ExportColumn = { sourceIndex: 0, name: 'd', typeId: 'date', kind: 'date' };

suite('export field formatter', () => {
	test('numeric coercion honors the decimal separator (DOT)', () => {
		const format = createFieldFormatter([numeric], DecimalSeparator.DOT);
		assert.deepStrictEqual(format('1.5', 0), { raw: '1.5', empty: false, coerced: '1.5' });
		assert.deepStrictEqual(format('+3', 0), { raw: '+3', empty: false, coerced: '3' });
		// A comma is not a decimal separator under DOT → not numeric → no coerced value.
		assert.deepStrictEqual(format('1,5', 0), { raw: '1,5', empty: false });
	});

	test('numeric coercion honors the decimal separator (COMMA)', () => {
		const format = createFieldFormatter([numeric], DecimalSeparator.COMMAS);
		assert.deepStrictEqual(format('1,5', 0), { raw: '1,5', empty: false, coerced: '1.5' });
		assert.deepStrictEqual(format('1.5', 0), { raw: '1.5', empty: false });
	});

	test('numeric coercion accepts both separators under BOTH', () => {
		const format = createFieldFormatter([numeric], DecimalSeparator.BOTH);
		assert.strictEqual(format('1,5', 0).coerced, '1.5');
		assert.strictEqual(format('1.5', 0).coerced, '1.5');
		assert.strictEqual(format('abc', 0).coerced, undefined);
	});

	test('empty / whitespace cells are flagged empty regardless of type', () => {
		const format = createFieldFormatter([numeric], DecimalSeparator.BOTH);
		assert.deepStrictEqual(format('   ', 0), { raw: '   ', empty: true });
	});

	test('text columns echo the raw value', () => {
		const format = createFieldFormatter([text], DecimalSeparator.BOTH);
		assert.deepStrictEqual(format('1,5', 0), { raw: '1,5', empty: false, coerced: '1,5' });
	});

	test('boolean coercion recognizes true/false only', () => {
		const format = createFieldFormatter([boolean], DecimalSeparator.BOTH);
		assert.strictEqual(format('TRUE', 0).coerced, 'true');
		assert.strictEqual(format('False', 0).coerced, 'false');
		assert.strictEqual(format('yes', 0).coerced, undefined);
	});

	test('date coercion yields an ISO string for parseable dates', () => {
		const format = createFieldFormatter([date], DecimalSeparator.BOTH);
		assert.strictEqual(format('2020-01-02T00:00:00.000Z', 0).coerced, '2020-01-02T00:00:00.000Z');
		assert.strictEqual(format('not a date', 0).coerced, undefined);
	});
});
