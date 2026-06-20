/// <reference types="mocha" />
import * as assert from 'assert';
import { CsvTokenizedPart, CsvTokenizedPartType, CsvTokenizer } from '../../csv/CsvTokenizer';

function parseAll(text: string): CsvTokenizedPart[] {
	const tokenizer = new CsvTokenizer(text);
	const parts: CsvTokenizedPart[] = [];

	while (true) {
		const part = tokenizer.parse();
		parts.push(part);

		if (part.type === CsvTokenizedPartType.END_OF_CONTENT) {
			return parts;
		}
	}
}

suite('CsvTokenizer', () => {
	test('returns end of content for empty input', () => {
		assert.deepStrictEqual(parseAll(''), [
			{ start: 0, end: 0, type: CsvTokenizedPartType.END_OF_CONTENT }
		]);
	});

	test('returns a single unquoted part', () => {
		assert.deepStrictEqual(parseAll('aaa,bbb\r\nccc'), [
			{ start: 0, end: 12, type: CsvTokenizedPartType.UNQUOTED },
			{ start: 12, end: 12, type: CsvTokenizedPartType.END_OF_CONTENT }
		]);
	});

	test('returns a single quoted part without the enclosing quote characters', () => {
		assert.deepStrictEqual(parseAll('"aaa,bbb"'), [
			{ start: 1, end: 8, type: CsvTokenizedPartType.QUOTED },
			{ start: 9, end: 9, type: CsvTokenizedPartType.END_OF_CONTENT }
		]);
	});

	test('returns an empty quoted part', () => {
		assert.deepStrictEqual(parseAll('""'), [
			{ start: 1, end: 1, type: CsvTokenizedPartType.QUOTED },
			{ start: 2, end: 2, type: CsvTokenizedPartType.END_OF_CONTENT }
		]);
	});

	test('splits unquoted and quoted parts in order', () => {
		assert.deepStrictEqual(parseAll('aaa,"bbb",ccc'), [
			{ start: 0, end: 4, type: CsvTokenizedPartType.UNQUOTED },
			{ start: 5, end: 8, type: CsvTokenizedPartType.QUOTED },
			{ start: 9, end: 13, type: CsvTokenizedPartType.UNQUOTED },
			{ start: 13, end: 13, type: CsvTokenizedPartType.END_OF_CONTENT }
		]);
	});

	test('treats line endings and separators as normal characters inside quoted parts', () => {
		const text = '"aaa\r\nbbb,ccc"';

		assert.deepStrictEqual(parseAll(text), [
			{ start: 1, end: 13, type: CsvTokenizedPartType.QUOTED },
			{ start: 14, end: 14, type: CsvTokenizedPartType.END_OF_CONTENT }
		]);
	});

	test('handles LF line endings inside quoted parts', () => {
		const text = '"aaa\nbbb"';

		assert.deepStrictEqual(parseAll(text), [
			{ start: 1, end: 8, type: CsvTokenizedPartType.QUOTED },
			{ start: 9, end: 9, type: CsvTokenizedPartType.END_OF_CONTENT }
		]);
	});

	test('handles CR line endings inside quoted parts', () => {
		const text = '"aaa\rbbb"';

		assert.deepStrictEqual(parseAll(text), [
			{ start: 1, end: 8, type: CsvTokenizedPartType.QUOTED },
			{ start: 9, end: 9, type: CsvTokenizedPartType.END_OF_CONTENT }
		]);
	});

	test('handles multiple line endings inside quoted parts', () => {
		const text = '"aaa\r\nbbb\nccc\rddd",eee,fff';

		assert.deepStrictEqual(parseAll(text), [
			{ start: 1, end: 17, type: CsvTokenizedPartType.QUOTED },
			{ start: 18, end: 26, type: CsvTokenizedPartType.UNQUOTED },
			{ start: 26, end: 26, type: CsvTokenizedPartType.END_OF_CONTENT }
		]);
	});

	test('treats line endings and separators as normal characters inside unquoted parts', () => {
		const text = 'aaa\r\nbbb,ccc';

		assert.deepStrictEqual(parseAll(text), [
			{ start: 0, end: 12, type: CsvTokenizedPartType.UNQUOTED },
			{ start: 12, end: 12, type: CsvTokenizedPartType.END_OF_CONTENT }
		]);
	});

	test('keeps RFC escaped double quotes inside quoted parts', () => {
		assert.deepStrictEqual(parseAll('"aaa""bbb"'), [
			{ start: 1, end: 9, type: CsvTokenizedPartType.QUOTED },
			{ start: 10, end: 10, type: CsvTokenizedPartType.END_OF_CONTENT }
		]);
	});

	test('handles an escaped quote as the only quoted content', () => {
		assert.deepStrictEqual(parseAll('""""'), [
			{ start: 1, end: 3, type: CsvTokenizedPartType.QUOTED },
			{ start: 4, end: 4, type: CsvTokenizedPartType.END_OF_CONTENT }
		]);
	});

	test('handles quoted parts separated by unquoted content', () => {
		assert.deepStrictEqual(parseAll('"a","b"'), [
			{ start: 1, end: 2, type: CsvTokenizedPartType.QUOTED },
			{ start: 3, end: 4, type: CsvTokenizedPartType.UNQUOTED },
			{ start: 5, end: 6, type: CsvTokenizedPartType.QUOTED },
			{ start: 7, end: 7, type: CsvTokenizedPartType.END_OF_CONTENT }
		]);
	});

	test('returns unterminated quoted content through the end of input', () => {
		assert.deepStrictEqual(parseAll('aaa,"bbb'), [
			{ start: 0, end: 4, type: CsvTokenizedPartType.UNQUOTED },
			{ start: 5, end: 8, type: CsvTokenizedPartType.QUOTED },
			{ start: 8, end: 8, type: CsvTokenizedPartType.END_OF_CONTENT }
		]);
	});
});
