/// <reference types="mocha" />
import * as assert from 'assert';
import { detectCellSeparator } from '../../csv/detectCellSeparator';

suite('detectCellSeparator', () => {
	test('detects comma as the most likely separator', () => {
		const content = 'a,b,c\n1,2,3\n4,5,6';

		assert.strictEqual(detectCellSeparator(content, 'LF'), ',');
	});

	test('detects semicolon while ignoring commas inside quoted parts', () => {
		const content = 'name;description;value\nalpha;"text, with, commas";1\nbeta;"more, text";2';

		assert.strictEqual(detectCellSeparator(content, 'LF'), ';');
	});

	test('detects tab separator with CRLF rows', () => {
		const content = 'a\tb\tc\r\n1\t2\t3\r\n4\t5\t6';

		assert.strictEqual(detectCellSeparator(content, 'CRLF'), '\t');
	});

	test('detects pipe separator while ignoring escaped quotes and separators inside quoted parts', () => {
		const content = 'a|b|c\n1|"quoted ""text"", with ; and |"|3\n4|5|6';

		assert.strictEqual(detectCellSeparator(content, 'LF'), '|');
	});

	test('does not break rows on line endings inside quoted parts', () => {
		const content = 'a;b;c\n1;"quoted\nline\nwith, commas";3\n4;5;6';

		assert.strictEqual(detectCellSeparator(content, 'LF'), ';');
	});

	test('prefers consistency over a higher one-row frequency', () => {
		const content = 'a\tb\n1\t2\nnoisy,line,with,many,commas';

		assert.strictEqual(detectCellSeparator(content, 'LF'), '\t');
	});

	test('supports literal line ending values', () => {
		const content = 'a;b;c\r\n1;2;3\r\n4;5;6';

		assert.strictEqual(detectCellSeparator(content, '\r\n'), ';');
	});

	test('ignores all candidate separators inside fully quoted cells', () => {
		const content = '"a,b;c|d"\t"e\tf"\t"g"\n"1,2;3|4"\t"5\t6"\t"7"';

		assert.strictEqual(detectCellSeparator(content, 'LF'), '\t');
	});

	test('ignores empty rows when checking separator consistency', () => {
		const content = '\nname;value;note\n\nalpha;1;"x,y|z"\n\nbeta;2;ok\n';

		assert.strictEqual(detectCellSeparator(content, 'LF'), ';');
	});

	test('handles trailing separators consistently', () => {
		const content = 'a,b,c,\n1,2,3,\n4,5,6,';

		assert.strictEqual(detectCellSeparator(content, 'LF'), ',');
	});

	test('uses only the provided CRLF row separator outside quoted cells', () => {
		const content = 'a|b|c\r\n1|"inside\nnot a row,;|\t"|3\r\n4|5|6';

		assert.strictEqual(detectCellSeparator(content, 'CRLF'), '|');
	});

	test('detects separators between quoted-only cells', () => {
		const content = '"a";"b";"c"\n"1";"2";"3"\n"4";"5";"6"';

		assert.strictEqual(detectCellSeparator(content, 'LF'), ';');
	});

	test('ignores separators next to escaped quotes inside quoted cells', () => {
		const content = 'a,b,c\n1,"value ""contains,comma"" and ; |",3\n4,5,6';

		assert.strictEqual(detectCellSeparator(content, 'LF'), ',');
	});

	test('handles an unterminated quoted final cell without counting its separators', () => {
		const content = 'a;b;c\n1;2;"unterminated\nwith,commas|pipes\tand;semis';

		assert.strictEqual(detectCellSeparator(content, 'LF'), ';');
	});

	test('handles spaces around separators and quoted cells', () => {
		const content = 'a ; b ; c\n1 ; "x,y" ; 3\n4 ; "z|w" ; 6';

		assert.strictEqual(detectCellSeparator(content, 'LF'), ';');
	});

	test('tolerates preamble rows that do not contain separators', () => {
		const content = 'Generated in 2026\nname|value|note\nalpha|1|x\nbeta|2|y';

		assert.strictEqual(detectCellSeparator(content, 'LF'), '|');
	});

	test('prefers a higher consistent field count for single-row content', () => {
		const content = 'a;b;c;d,e';

		assert.strictEqual(detectCellSeparator(content, 'LF'), ';');
	});

	test('supports CR-only row separators', () => {
		const content = 'a,b,c\r1,2,3\r4,5,6';

		assert.strictEqual(detectCellSeparator(content, 'CR'), ',');
	});

	test('handles empty quoted cells at row starts', () => {
		const content = '"";name;value\n"";alpha;1\n"";beta;2';

		assert.strictEqual(detectCellSeparator(content, 'LF'), ';');
	});

	test('defaults to comma when no separator is found', () => {
		assert.strictEqual(detectCellSeparator('abc\ndef', 'LF'), ',');
	});
});
