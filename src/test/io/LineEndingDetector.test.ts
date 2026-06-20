/// <reference types="mocha" />
import * as assert from 'assert';
import { LineEndingDetector } from '../../io/LineEndingDetector';

function detectFromChunks(chunks: string[]): string {
	const detector = new LineEndingDetector();

	for (const chunk of chunks) {
		detector.addContent(chunk);
	}

	return detector.getMostLikelyLineEndings();
}

suite('LineEndingDetector', () => {
	test('detects CRLF when most common', () => {
		assert.strictEqual(detectFromChunks(['line1\r\nline2\r\nline3']), 'CRLF');
	});

	test('detects CR when most common', () => {
		assert.strictEqual(detectFromChunks(['line1\rline2\rline3']), 'CR');
	});

	test('detects LF when most common', () => {
		assert.strictEqual(detectFromChunks(['line1\nline2\nline3']), 'LF');
	});

	test('handles CRLF split across chunks', () => {
		assert.strictEqual(detectFromChunks(['line1\r', '\nline2\r', '\nline3']), 'CRLF');
	});

	test('does not count split CRLF as separate CR and LF endings', () => {
		assert.strictEqual(detectFromChunks(['line1\r', '\nline2']), 'CRLF');
	});

	test('counts pending trailing CR as CR for current result', () => {
		assert.strictEqual(detectFromChunks(['line1\r']), 'CR');
	});

	test('keeps pending trailing CR available for later CRLF detection', () => {
		const detector = new LineEndingDetector();

		detector.addContent('line1\r');
		assert.strictEqual(detector.getMostLikelyLineEndings(), 'CR');

		detector.addContent('\nline2\r\n');
		assert.strictEqual(detector.getMostLikelyLineEndings(), 'CRLF');
	});

	test('handles mixed line endings with LF dominant', () => {
		assert.strictEqual(detectFromChunks(['line1\nline2\rline3\nline4']), 'LF');
	});

	test('handles mixed line endings with CR dominant', () => {
		assert.strictEqual(detectFromChunks(['line1\rline2\nline3\rline4']), 'CR');
	});

	test('defaults to LF for empty content', () => {
		assert.strictEqual(detectFromChunks([]), 'LF');
	});

	test('defaults to LF when there are no line endings', () => {
		assert.strictEqual(detectFromChunks(['line1 ', 'line2 ', 'line3']), 'LF');
	});

	test('matches existing tie behavior', () => {
		assert.strictEqual(detectFromChunks(['line1\r\nline2\nline3']), 'LF');
		assert.strictEqual(detectFromChunks(['line1\r\nline2\rline3']), 'CR');
	});
});
