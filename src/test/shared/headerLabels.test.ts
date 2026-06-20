/// <reference types="mocha" />
import * as assert from 'assert';
import { defaultHeaderLabel, materializeHeaderCell, materializeHeaderNames } from '../../shared/headerLabels';

suite('headerLabels', () => {
	test('defaultHeaderLabel is a 1-based column_N', () => {
		assert.strictEqual(defaultHeaderLabel(0), 'column_1');
		assert.strictEqual(defaultHeaderLabel(2), 'column_3');
	});

	test('materializeHeaderCell keeps a name and defaults empty/missing cells', () => {
		assert.strictEqual(materializeHeaderCell('Hello', 1), 'Hello');
		assert.strictEqual(materializeHeaderCell('', 1), 'column_2');
		assert.strictEqual(materializeHeaderCell(undefined, 0), 'column_1');
	});

	test('materializeHeaderNames fills empty and missing cells up to columnCount', () => {
		assert.deepStrictEqual(materializeHeaderNames(['', 'Hello', ''], 3), ['column_1', 'Hello', 'column_3']);
		assert.deepStrictEqual(materializeHeaderNames(['a'], 3), ['a', 'column_2', 'column_3']);
		assert.deepStrictEqual(materializeHeaderNames(['id', 'name'], 2), ['id', 'name']);
	});
});
