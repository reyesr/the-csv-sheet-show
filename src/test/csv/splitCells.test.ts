/// <reference types="mocha" />
import * as assert from 'assert';
import { splitCells } from '../../csv/splitCells';

suite('splitCells', () => {
	test('splits unquoted comma-separated cells', () => {
		assert.deepStrictEqual(splitCells('a,b,c', ','), ['a', 'b', 'c']);
	});

	test('returns a single cell when separator is not present', () => {
		assert.deepStrictEqual(splitCells('abc', ','), ['abc']);
	});

	test('preserves empty cells', () => {
		assert.deepStrictEqual(splitCells(',a,,b,', ','), ['', 'a', '', 'b', '']);
	});

	test('does not split on separators inside quoted cells', () => {
		assert.deepStrictEqual(splitCells('a,"b,c",d', ','), ['a', 'b,c', 'd']);
	});

	test('removes enclosing quotes from quoted cells', () => {
		assert.deepStrictEqual(splitCells('"a","b","c"', ','), ['a', 'b', 'c']);
	});

	test('unescapes RFC escaped double quotes inside quoted cells', () => {
		assert.deepStrictEqual(splitCells('a,"b""c",d', ','), ['a', 'b"c', 'd']);
	});

	test('keeps line endings inside quoted cells', () => {
		assert.deepStrictEqual(splitCells('a,"b\n c",d', ','), ['a', 'b\n c', 'd']);
	});

	test('splits using semicolon separators', () => {
		assert.deepStrictEqual(splitCells('a;"b;c";d', ';'), ['a', 'b;c', 'd']);
	});

	test('splits using tab separators', () => {
		assert.deepStrictEqual(splitCells('a\t"b\tc"\td', '\t'), ['a', 'b\tc', 'd']);
	});

	test('splits using pipe separators', () => {
		assert.deepStrictEqual(splitCells('a|"b|c"|d', '|'), ['a', 'b|c', 'd']);
	});

	test('preserves spaces outside quoted cells', () => {
		assert.deepStrictEqual(splitCells(' a , "b" , c ', ','), [' a ', ' b ', ' c ']);
	});

	test('handles quoted content mixed with unquoted content in the same cell', () => {
		assert.deepStrictEqual(splitCells('a"b,c"d,e', ','), ['ab,cd', 'e']);
	});

	test('handles an unterminated quoted final cell', () => {
		assert.deepStrictEqual(splitCells('a,"b,c', ','), ['a', 'b,c']);
	});

	test('returns original line when separator is empty', () => {
		assert.deepStrictEqual(splitCells('a,b,c', ''), ['a,b,c']);
	});
});
