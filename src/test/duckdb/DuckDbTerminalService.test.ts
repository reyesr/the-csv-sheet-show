/// <reference types="mocha" />
import * as assert from 'assert';
import { DecimalSeparator, type CsvFileConfig } from '../../csv/CsvFileConfig';
import { buildReadCsvSource } from '../../duckdb/DuckDbTerminalService';

function makeConfig(overrides: Partial<CsvFileConfig> = {}): CsvFileConfig {
	return {
		separator: ',',
		encoding: 'utf8',
		lineEnding: '\n',
		decimalSeparator: DecimalSeparator.DOT,
		hasHeader: true,
		...overrides
	};
}

suite('buildReadCsvSource', () => {
	test('falls back to read_csv_auto when the config is not yet detected', () => {
		assert.strictEqual(
			buildReadCsvSource('/tmp/data.csv', null, '.'),
			"read_csv_auto('/tmp/data.csv')"
		);
	});

	test('mirrors delimiter, header, and the chosen decimal separator', () => {
		assert.strictEqual(
			buildReadCsvSource('/tmp/data.csv', makeConfig(), '.'),
			"read_csv('/tmp/data.csv', delim=',', header=true, decimal_separator='.')"
		);
	});

	test('emits header=false for a header-less file', () => {
		assert.strictEqual(
			buildReadCsvSource('/tmp/data.csv', makeConfig({ hasHeader: false }), '.'),
			"read_csv('/tmp/data.csv', delim=',', header=false, decimal_separator='.')"
		);
	});

	test('uses the requested decimal separator, not the detected one', () => {
		// The detected config says DOT, but the user overrode it to a comma in the Tools panel.
		assert.strictEqual(
			buildReadCsvSource('/tmp/data.csv', makeConfig({ decimalSeparator: DecimalSeparator.DOT }), ','),
			"read_csv('/tmp/data.csv', delim=',', header=true, decimal_separator=',')"
		);
	});

	test('escapes a tab delimiter as the two-character \\t', () => {
		assert.strictEqual(
			buildReadCsvSource('/tmp/data.tsv', makeConfig({ separator: '\t' }), '.'),
			"read_csv('/tmp/data.tsv', delim='\\t', header=true, decimal_separator='.')"
		);
	});

	test('passes a semicolon delimiter through unchanged', () => {
		assert.strictEqual(
			buildReadCsvSource('/tmp/data.csv', makeConfig({ separator: ';' }), ','),
			"read_csv('/tmp/data.csv', delim=';', header=true, decimal_separator=',')"
		);
	});

	test('normalizes Windows backslashes to forward slashes in the path', () => {
		assert.strictEqual(
			buildReadCsvSource('C:\\Users\\me\\data.csv', makeConfig(), '.'),
			"read_csv('C:/Users/me/data.csv', delim=',', header=true, decimal_separator='.')"
		);
	});

	test('escapes single quotes in the path by doubling them', () => {
		assert.strictEqual(
			buildReadCsvSource("/tmp/o'brien.csv", null, '.'),
			"read_csv_auto('/tmp/o''brien.csv')"
		);
	});
});
