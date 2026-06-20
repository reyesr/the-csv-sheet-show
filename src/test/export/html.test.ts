/// <reference types="mocha" />
import * as assert from 'assert';
import { DecimalSeparator } from '../../csv/DataTypes';
import { createHtmlEncoder, escapeHtml } from '../../export/encoders/html';
import { createFieldFormatter } from '../../export/fieldFormatter';
import type { ExportColumn, ExportContext } from '../../export/types';

type Styling = Partial<Pick<ExportColumn, 'align' | 'foregroundColor' | 'backgroundColor'>>;

function col(sourceIndex: number, name: string, styling: Styling = {}): ExportColumn {
	return { sourceIndex, name, typeId: 'text', kind: 'text', ...styling };
}

/** Drive the HTML encoder over `rows` exactly as ExportService does, returning the full output. */
function runHtml(
	columns: ExportColumn[],
	rows: string[][],
	formatOptions: Record<string, unknown>,
	hasHeader = true
): string {
	const context: ExportContext = {
		columns,
		hasHeader,
		rowCount: rows.length,
		formatOptions,
		formatField: createFieldFormatter(columns, DecimalSeparator.BOTH)
	};
	const encoder = createHtmlEncoder();
	let output = encoder.begin(context);
	rows.forEach((row, index) => {
		output += encoder.encodeRow(columns.map(column => row[column.sourceIndex] ?? ''), index, context);
	});
	return output + encoder.end(context);
}

suite('HTML export encoder', () => {
	test('styled-fragment, classes mode, alignment + color → CSS classes (the plan example)', () => {
		const columns = [col(0, 'Item'), col(1, 'Price', { align: 'right', foregroundColor: '#ff0000' })];
		const rows = [['Apple', '0.50'], ['Café & Tea', '1.50']];
		const output = runHtml(columns, rows, { wrap: 'styled-fragment', styleMode: 'classes', tableClass: 'csv-export' });

		assert.strictEqual(output, [
			'<style>',
			'table.csv-export { border-collapse: collapse; }',
			'table.csv-export th, table.csv-export td { border: 1px solid #ccc; padding: 2px 6px; white-space: pre-wrap; }',
			'table.csv-export .col-1 { text-align: right; color: #ff0000; }',
			'</style>',
			'<table class="csv-export">',
			'<thead><tr><th scope="col">Item</th><th scope="col" class="col-1">Price</th></tr></thead>',
			'<tbody>',
			'<tr><td>Apple</td><td class="col-1">0.50</td></tr>',
			'<tr><td>Café &amp; Tea</td><td class="col-1">1.50</td></tr>',
			'</tbody>',
			'</table>',
			''
		].join('\n'));
	});

	test('fragment wrap forces inline styles and a bare <table>', () => {
		const columns = [col(0, 'Item'), col(1, 'Price', { align: 'right', foregroundColor: '#ff0000' })];
		const output = runHtml(columns, [['Apple', '0.50']], { wrap: 'fragment' });

		assert.strictEqual(output, [
			'<table>',
			'<thead><tr><th scope="col">Item</th><th scope="col" style="text-align:right;color:#ff0000">Price</th></tr></thead>',
			'<tbody>',
			'<tr><td>Apple</td><td style="text-align:right;color:#ff0000">0.50</td></tr>',
			'</tbody>',
			'</table>',
			''
		].join('\n'));
	});

	test('background color and uppercase hex are emitted; malformed colors are skipped', () => {
		const columns = [
			col(0, 'bad', { foregroundColor: 'red', backgroundColor: '#GGGGGG' }),
			col(1, 'good', { backgroundColor: '#00FF00' })
		];
		const output = runHtml(columns, [['x', 'y']], { wrap: 'styled-fragment', styleMode: 'classes' });

		// The malformed-color column contributes no rule/class; the valid one keeps its (uppercase) hex.
		assert.ok(!output.includes('.col-0'), 'column with only malformed colors should have no class');
		assert.ok(output.includes('table.csv-export .col-1 { background-color: #00FF00; }'));
		assert.ok(output.includes('<td>x</td><td class="col-1">y</td>'));
	});

	test('escapes & < > in content but not quotes', () => {
		const output = runHtml([col(0, 'c')], [['<b>a & b</b> "q\' "']], { wrap: 'fragment', includeHeaderRow: false });
		assert.ok(output.includes('<td>&lt;b&gt;a &amp; b&lt;/b&gt; "q\' "</td>'));
		assert.strictEqual(escapeHtml('a<b>&c'), 'a&lt;b&gt;&amp;c');
	});

	test('document wrap adds doctype, charset meta, head style block and body wrapper', () => {
		const output = runHtml([col(0, 'a')], [['1']], { wrap: 'document' });
		assert.ok(output.startsWith('<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n'));
		assert.ok(output.includes('<title>Exported data</title>'));
		assert.ok(output.includes('</head>\n<body>\n<table class="csv-export">'));
		assert.ok(output.endsWith('</tbody>\n</table>\n</body>\n</html>\n'));
	});

	test('header row omitted when includeHeaderRow is false or the document has no header', () => {
		const off = runHtml([col(0, 'a')], [['1']], { wrap: 'styled-fragment', includeHeaderRow: false });
		assert.ok(!off.includes('<thead'));

		const noHeader = runHtml([col(0, 'a')], [['1']], { wrap: 'styled-fragment', includeHeaderRow: true }, false);
		assert.ok(!noHeader.includes('<thead'));
	});

	test('newline mode: <br> conversion vs inline pre-wrap on multi-line cells', () => {
		const br = runHtml([col(0, 'c')], [['a\nb']], { wrap: 'fragment', includeHeaderRow: false, newline: 'br' });
		assert.ok(br.includes('<td>a<br>b</td>'));

		const preWrap = runHtml([col(0, 'c')], [['a\nb']], { wrap: 'fragment', includeHeaderRow: false, newline: 'pre-wrap' });
		assert.ok(preWrap.includes('<td style="white-space:pre-wrap">a\nb</td>'));
	});

	test('distinct styled columns each get their own positional class', () => {
		const columns = [col(0, 'a', { align: 'center' }), col(1, 'b', { align: 'right' })];
		const output = runHtml(columns, [['x', 'y']], { wrap: 'styled-fragment', styleMode: 'classes' });
		assert.ok(output.includes('table.csv-export .col-0 { text-align: center; }'));
		assert.ok(output.includes('table.csv-export .col-1 { text-align: right; }'));
		assert.ok(output.includes('<td class="col-0">x</td><td class="col-1">y</td>'));
	});

	test('unsupported table class falls back to the default identifier', () => {
		const output = runHtml([col(0, 'a')], [['1']], { wrap: 'styled-fragment', tableClass: 'my table!' });
		// 'my table!' → 'mytable' (non-identifier chars stripped).
		assert.ok(output.includes('<table class="mytable">'));
	});

	test('empty dataset still produces a header table with an empty body', () => {
		const output = runHtml([col(0, 'a'), col(1, 'b')], [], { wrap: 'styled-fragment', styleMode: 'classes' });
		assert.ok(output.includes('<thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead>'));
		assert.ok(output.includes('<tbody>\n</tbody>\n</table>\n'));
	});
});
