/// <reference types="mocha" />
import * as assert from 'assert';
import { encodeCells } from '../../csv/encodeCells';
import { splitCells } from '../../csv/splitCells';

suite('encodeCells', () => {
	test('emits plain cells without quoting', () => {
		assert.strictEqual(encodeCells(['a', 'b', 'c'], ','), 'a,b,c');
	});

	test('preserves empty cells', () => {
		assert.strictEqual(encodeCells(['', 'a', '', 'b', ''], ','), ',a,,b,');
	});

	test('quotes cells containing the separator', () => {
		assert.strictEqual(encodeCells(['a', 'b,c', 'd'], ','), 'a,"b,c",d');
	});

	test('quotes and doubles inner double quotes', () => {
		assert.strictEqual(encodeCells(['a', 'b"c', 'd'], ','), 'a,"b""c",d');
	});

	test('quotes cells containing line breaks', () => {
		assert.strictEqual(encodeCells(['a', 'b\nc', 'd'], ','), 'a,"b\nc",d');
	});

	test('uses the configured separator', () => {
		assert.strictEqual(encodeCells(['a', 'b;c', 'd'], ';'), 'a;"b;c";d');
	});

	test('round-trips with splitCells', () => {
		const rows = [
			['simple', 'cells'],
			['with,comma', 'with"quote'],
			['with\nnewline', ''],
			['', 'trailing']
		];
		for (const row of rows) {
			assert.deepStrictEqual(splitCells(encodeCells(row, ','), ','), row);
		}
	});
});
