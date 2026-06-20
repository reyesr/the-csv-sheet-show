/// <reference types="mocha" />
import * as assert from 'assert';
import * as iconv from 'iconv-lite';
import { CsvFileConfig, DecimalSeparator } from '../../csv/CsvFileConfig';
import { detectConfig } from '../../csv/detectConfig';

suite('detectConfig', () => {
	test('detects comma CSV with LF, dot decimals, and text header', () => {
		const config = detectConfig(Buffer.from('name,amount\nalpha,1.25\nbeta,2.50', 'utf8'));

		assert.strictEqual(config.separator, ',');
		assert.strictEqual(config.lineEnding, '\n');
		assert.strictEqual(config.decimalSeparator, DecimalSeparator.DOT);
		assert.strictEqual(config.hasHeader, true);
	});

	test('detects semicolon CSV with CRLF and comma decimals', () => {
		const config = detectConfig(Buffer.from('name;amount\r\nalpha;1,25\r\nbeta;2,50', 'utf8'));

		assert.strictEqual(config.separator, ';');
		assert.strictEqual(config.lineEnding, '\r\n');
		assert.strictEqual(config.decimalSeparator, DecimalSeparator.COMMAS);
		assert.strictEqual(config.hasHeader, true);
	});

	test('respects provided config fields and detects only missing fields', () => {
		const provided: Partial<CsvFileConfig> = {
			separator: '|',
			lineEnding: 'LF',
			decimalSeparator: DecimalSeparator.DOT,
			hasHeader: false,
			encoding: 'utf8'
		};
		const config = detectConfig(Buffer.from('NAME|VALUE\nalpha|1.25', 'utf8'), provided);

		assert.deepStrictEqual(config, {
			separator: '|',
			encoding: 'utf8',
			lineEnding: '\n',
			decimalSeparator: DecimalSeparator.DOT,
			hasHeader: false
		});
	});

	test('decodes provided windows-1252 encoding with iconv-lite fallback', () => {
		const buffer = iconv.encode('nom;âge\nAndré;42', 'windows-1252');
		const config = detectConfig(buffer, { encoding: 'windows-1252' });

		assert.strictEqual(config.encoding, 'windows-1252');
		assert.strictEqual(config.separator, ';');
		assert.strictEqual(config.lineEnding, '\n');
		assert.strictEqual(config.hasHeader, true);
	});

	test('ignores quoted multiline content while detecting line endings and separator', () => {
		const content = 'name;note;amount\r\nalpha;"line one\nline two, still note";1,25\r\nbeta;ok;2,50';
		const config = detectConfig(Buffer.from(content, 'utf8'));

		assert.strictEqual(config.separator, ';');
		assert.strictEqual(config.lineEnding, '\r\n');
		assert.strictEqual(config.decimalSeparator, DecimalSeparator.COMMAS);
		assert.strictEqual(config.hasHeader, true);
	});

	test('defaults decimal separator to BOTH when no decimals are found', () => {
		const config = detectConfig(Buffer.from('a|b\n1|2\n3|4', 'utf8'));

		assert.strictEqual(config.separator, '|');
		assert.strictEqual(config.decimalSeparator, DecimalSeparator.BOTH);
	});

	test('returns BOTH when dot and comma decimals tie', () => {
		const config = detectConfig(Buffer.from('value;other\n1.5;2,5', 'utf8'));

		assert.strictEqual(config.decimalSeparator, DecimalSeparator.BOTH);
	});

	test('does not count malformed decimal-looking cells for decimal separator detection', () => {
		const config = detectConfig(Buffer.from('a;b\n1.2.3;text\n4,5;ok', 'utf8'));

		assert.strictEqual(config.separator, ';');
		assert.strictEqual(config.decimalSeparator, DecimalSeparator.COMMAS);
	});

	test('uses the rightmost separator in mixed-separator cells (US grouping, dot decimal)', () => {
		const config = detectConfig(Buffer.from('label;amount\nalpha;1,234.56\nbeta;2,345.67', 'utf8'));

		assert.strictEqual(config.separator, ';');
		assert.strictEqual(config.decimalSeparator, DecimalSeparator.DOT);
	});

	test('uses the rightmost separator in mixed-separator cells (EU grouping, comma decimal)', () => {
		const config = detectConfig(Buffer.from('label;amount\nalpha;1.234,56\nbeta;2.345,67', 'utf8'));

		assert.strictEqual(config.separator, ';');
		assert.strictEqual(config.decimalSeparator, DecimalSeparator.COMMAS);
	});

	test('infers dot decimal from repeated comma grouping', () => {
		const config = detectConfig(Buffer.from('label;total\nalpha;1,234,567\nbeta;7,654,321', 'utf8'));

		assert.strictEqual(config.separator, ';');
		assert.strictEqual(config.decimalSeparator, DecimalSeparator.DOT);
	});

	test('infers comma decimal from repeated dot grouping', () => {
		const config = detectConfig(Buffer.from('label;total\nalpha;1.234.567\nbeta;7.654.321', 'utf8'));

		assert.strictEqual(config.separator, ';');
		assert.strictEqual(config.decimalSeparator, DecimalSeparator.COMMAS);
	});

	test('ignores ambiguous thousands groupings so real dot decimals win', () => {
		const config = detectConfig(Buffer.from('a;b\n1,000;3.5\n2,000;4.5', 'utf8'));

		assert.strictEqual(config.separator, ';');
		assert.strictEqual(config.decimalSeparator, DecimalSeparator.DOT);
	});

	test('lets decisive mixed-separator evidence override a conflicting single-separator cell', () => {
		const config = detectConfig(Buffer.from('x;y\nalpha;1.234,56\nbeta;7.7', 'utf8'));

		assert.strictEqual(config.separator, ';');
		assert.strictEqual(config.decimalSeparator, DecimalSeparator.COMMAS);
	});

	test('detects no header when first row contains a number', () => {
		const config = detectConfig(Buffer.from('name,1\nalpha,2', 'utf8'));

		assert.strictEqual(config.hasHeader, false);
	});

	test('detects no header when first row contains an empty cell', () => {
		const config = detectConfig(Buffer.from('name,\nalpha,1', 'utf8'));

		assert.strictEqual(config.hasHeader, false);
	});

	test('detects no header when following rows are all text and non-empty', () => {
		const config = detectConfig(Buffer.from('name,value\nalpha,beta\ngamma,delta', 'utf8'));

		assert.strictEqual(config.hasHeader, false);
	});

	test('detects header using uppercase fallback algorithm', () => {
		const config = detectConfig(Buffer.from('CODE|LABEL\naa|alpha\nbb|beta', 'utf8'));

		assert.strictEqual(config.separator, '|');
		assert.strictEqual(config.hasHeader, true);
	});

	test('does not use uppercase fallback when first row has an empty cell', () => {
		const config = detectConfig(Buffer.from('CODE|\naa|alpha', 'utf8'));

		assert.strictEqual(config.hasHeader, false);
	});

	test('detects header when following rows contain empty cells', () => {
		const config = detectConfig(Buffer.from('name,amount\nalpha,\nbeta,2', 'utf8'));

		assert.strictEqual(config.hasHeader, true);
	});

	test('handles tab-separated files with CR-only line endings', () => {
		const config = detectConfig(Buffer.from('name\tamount\ralpha\t1.5\rbeta\t2.5', 'utf8'));

		assert.strictEqual(config.separator, '\t');
		assert.strictEqual(config.lineEnding, '\r');
		assert.strictEqual(config.decimalSeparator, DecimalSeparator.DOT);
		assert.strictEqual(config.hasHeader, true);
	});

	test('uses provided literal line ending unchanged', () => {
		const config = detectConfig(Buffer.from('a;b\r\n1;2', 'utf8'), { lineEnding: '\r\n' });

		assert.strictEqual(config.lineEnding, '\r\n');
		assert.strictEqual(config.separator, ';');
	});

	test('detects config for empty content with safe defaults', () => {
		const config = detectConfig(Buffer.from('', 'utf8'));

		assert.strictEqual(config.separator, ',');
		assert.strictEqual(config.lineEnding, '\n');
		assert.strictEqual(config.decimalSeparator, DecimalSeparator.BOTH);
		assert.strictEqual(config.hasHeader, false);
	});
});
