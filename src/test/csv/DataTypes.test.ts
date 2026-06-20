/// <reference types="mocha" />
import * as assert from 'assert';
import { CellType, DecimalSeparator, detectCellType, detectCellTypes } from '../../csv/DataTypes';

suite('DataTypes', () => {
	test('detects empty cells', () => {
		for (const cell of ['', ' ', '\t', '\r\n', ' \t ']) {
			assert.strictEqual(detectCellType(cell), CellType.EMPTY, cell);
		}
	});

	test('detects signed and unsigned integers', () => {
		for (const cell of ['0', '123', '+123', '-123', ' 42 ']) {
			assert.strictEqual(detectCellType(cell), CellType.NUMBER, cell);
		}
	});

	test('detects dot decimals when dot separator is allowed', () => {
		for (const cell of ['1.23', '-0.5', '+0.5', '.5', '5.']) {
			assert.strictEqual(detectCellType(cell, DecimalSeparator.DOT), CellType.NUMBER, cell);
			assert.strictEqual(detectCellType(cell, DecimalSeparator.BOTH), CellType.NUMBER, cell);
		}
	});

	test('detects comma decimals when comma separator is allowed', () => {
		for (const cell of ['1,23', '-0,5', '+0,5', ',5', '5,']) {
			assert.strictEqual(detectCellType(cell, DecimalSeparator.COMMAS), CellType.NUMBER, cell);
			assert.strictEqual(detectCellType(cell, DecimalSeparator.BOTH), CellType.NUMBER, cell);
		}
	});

	test('respects decimal separator configuration', () => {
		assert.strictEqual(detectCellType('1,23', DecimalSeparator.DOT), CellType.TEXT);
		assert.strictEqual(detectCellType('1.23', DecimalSeparator.COMMAS), CellType.TEXT);
	});

	test('rejects ambiguous or repeated decimal separators', () => {
		for (const cell of ['1.2.3', '1,2,3', '1,234.56', '1.234,56']) {
			assert.strictEqual(detectCellType(cell), CellType.TEXT, cell);
		}
	});

	test('rejects signs without digits', () => {
		for (const cell of ['+', '-', '+.', '-.', '+,', '-,']) {
			assert.strictEqual(detectCellType(cell), CellType.TEXT, cell);
		}
	});

	test('rejects non-numeric text and mixed text-number cells', () => {
		for (const cell of ['abc', '12a', 'a12', '1 2', '--1', '+-1', '1-2']) {
			assert.strictEqual(detectCellType(cell), CellType.TEXT, cell);
		}
	});

	test('rejects common real-world non-plain-number values', () => {
		for (const cell of ['NaN', 'Infinity', '1e3', '10%', '$10.50', '2026-06-07', '(123)', '1,234,567']) {
			assert.strictEqual(detectCellType(cell), CellType.TEXT, cell);
		}
	});

	test('detects text for decimal separator characters without digits', () => {
		assert.strictEqual(detectCellType('.'), CellType.TEXT);
		assert.strictEqual(detectCellType(','), CellType.TEXT);
	});

	test('detects cell types for an array of cells', () => {
		assert.deepStrictEqual(detectCellTypes(['', '42', 'hello', '1,5']), [
			CellType.EMPTY,
			CellType.NUMBER,
			CellType.TEXT,
			CellType.NUMBER
		]);
	});

	test('passes decimal separator configuration to array detection', () => {
		assert.deepStrictEqual(detectCellTypes(['1.5', '1,5'], DecimalSeparator.DOT), [
			CellType.NUMBER,
			CellType.TEXT
		]);
	});
});
