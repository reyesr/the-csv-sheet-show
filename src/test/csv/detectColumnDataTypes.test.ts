/// <reference types="mocha" />
import * as assert from 'assert';
import { ColumnType, detectColumnDataTypes } from '../../csv/detectColumnDataTypes';

suite('detectColumnDataTypes', () => {
	test('classifies plain integers and free text', () => {
		const result = detectColumnDataTypes(['1,a', '2,b', '3,c'], ',');

		assert.deepStrictEqual(result, [
			{ type: ColumnType.INTEGER },
			{ type: ColumnType.TEXT }
		]);
	});

	test('detects dot decimals with the OS locale', () => {
		const result = detectColumnDataTypes(['1.5,x', '2.25,y', '3.0,z'], ',', { osLocale: 'en-US' });

		assert.deepStrictEqual(result[0], { type: ColumnType.DECIMAL, locale: 'en-US' });
		assert.strictEqual(result[1].type, ColumnType.TEXT);
	});

	test('detects comma decimals with dot grouping (de-DE)', () => {
		const result = detectColumnDataTypes(['1.234,56;x', '2.000,10;y'], ';', { osLocale: 'de-DE' });

		assert.deepStrictEqual(result[0], { type: ColumnType.DECIMAL, locale: 'de-DE' });
	});

	test('detects grouped integers as INTEGER carrying the inferred locale', () => {
		const result = detectColumnDataTypes(['1,234,567;x', '2,000,000;y'], ';', { osLocale: 'en-US' });

		assert.deepStrictEqual(result[0], { type: ColumnType.INTEGER, locale: 'en-US' });
	});

	test('detects Indian (3-2-2) grouping', () => {
		const result = detectColumnDataTypes(['12,34,567.89;x', '1,23,456.00;y'], ';', { osLocale: 'en-US' });

		assert.deepStrictEqual(result[0], { type: ColumnType.DECIMAL, locale: 'en-IN' });
	});

	test('detects Arabic decimal separators and digits (ar-SA)', () => {
		// Arabic-Indic digits (U+0660-0669) with thousands (U+066C) and decimal (U+066B):
		// "1٬234٫56" and "2٬000٫10".
		const a = '١٬٢٣٤٫٥٦';
		const b = '٢٬٠٠٠٫١٠';
		const result = detectColumnDataTypes([`${a};x`, `${b};y`], ';');

		assert.deepStrictEqual(result[0], { type: ColumnType.DECIMAL, locale: 'ar-SA' });
	});

	test('uses the OS locale to break ties between equally likely locales', () => {
		const rows = ['1,5;3,5', '2,5;4,5'];

		const french = detectColumnDataTypes(rows, ';', { osLocale: 'fr-FR' });
		assert.deepStrictEqual(french, [
			{ type: ColumnType.DECIMAL, locale: 'fr-FR' },
			{ type: ColumnType.DECIMAL, locale: 'fr-FR' }
		]);

		const german = detectColumnDataTypes(rows, ';', { osLocale: 'de-DE' });
		assert.deepStrictEqual(german, [
			{ type: ColumnType.DECIMAL, locale: 'de-DE' },
			{ type: ColumnType.DECIMAL, locale: 'de-DE' }
		]);
	});

	test('falls back per-column when columns cannot share one locale', () => {
		// Column 0 is dot-decimal (S1/S4); column 1 is comma-decimal (S2/S3); intersection is empty.
		const result = detectColumnDataTypes(['1.5;1,5', '2.5;2,5'], ';', { osLocale: 'en-US' });

		assert.deepStrictEqual(result[0], { type: ColumnType.DECIMAL, locale: 'en-US' });
		assert.deepStrictEqual(result[1], { type: ColumnType.DECIMAL, locale: 'de-DE' });
	});

	test('resolves the INTEGER/DECIMAL ambiguity of single-dot values via locale', () => {
		const rows = ['1.234;x', '5.678;y'];

		// English: "1.234" is a decimal.
		assert.deepStrictEqual(
			detectColumnDataTypes(rows, ';', { osLocale: 'en-US' })[0],
			{ type: ColumnType.DECIMAL, locale: 'en-US' }
		);

		// German: "1.234" is a grouped integer (1234).
		assert.deepStrictEqual(
			detectColumnDataTypes(rows, ';', { osLocale: 'de-DE' })[0],
			{ type: ColumnType.INTEGER, locale: 'de-DE' }
		);
	});

	test('skips the header row when hasHeader is set', () => {
		const rows = ['name;value', 'alpha;1.5', 'beta;2.5'];

		const withHeader = detectColumnDataTypes(rows, ';', { hasHeader: true, osLocale: 'en-US' });
		assert.strictEqual(withHeader[0].type, ColumnType.TEXT);
		assert.deepStrictEqual(withHeader[1], { type: ColumnType.DECIMAL, locale: 'en-US' });

		// Without skipping, the text label "value" poisons the column.
		const withoutHeader = detectColumnDataTypes(rows, ';', { osLocale: 'en-US' });
		assert.strictEqual(withoutHeader[1].type, ColumnType.TEXT);
	});

	test('treats missing trailing cells as empty (ragged rows)', () => {
		const result = detectColumnDataTypes(['1;2;3', '4;5'], ';');

		assert.deepStrictEqual(result, [
			{ type: ColumnType.INTEGER },
			{ type: ColumnType.INTEGER },
			{ type: ColumnType.INTEGER }
		]);
	});

	test('classifies all-empty columns as TEXT', () => {
		const result = detectColumnDataTypes(['1;', '2;'], ';');

		assert.strictEqual(result[0].type, ColumnType.INTEGER);
		assert.strictEqual(result[1].type, ColumnType.TEXT);
	});

	test('respects maxRows when sampling', () => {
		const rows = ['1,a', '2,b', '3,c', 'x,d'];

		assert.strictEqual(detectColumnDataTypes(rows, ',', { maxRows: 3 })[0].type, ColumnType.INTEGER);
		assert.strictEqual(detectColumnDataTypes(rows, ',')[0].type, ColumnType.TEXT);
	});

	test('handles signed numbers and mixed plain integers with decimals', () => {
		const result = detectColumnDataTypes(['-1.5,10', '+2.25,-20', '3,30'], ',', { osLocale: 'en-US' });

		assert.deepStrictEqual(result[0], { type: ColumnType.DECIMAL, locale: 'en-US' });
		assert.deepStrictEqual(result[1], { type: ColumnType.INTEGER });
	});

	test('returns an empty array when there are no columns', () => {
		assert.deepStrictEqual(detectColumnDataTypes([], ','), []);
	});
});
