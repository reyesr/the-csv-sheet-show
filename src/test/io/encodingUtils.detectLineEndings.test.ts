/// <reference types="mocha" />
import * as assert from 'assert';
import { detectLineEndings } from '../../io/EncodingUtils';

suite('detectLineEndings', () => {
  test('should detect CRLF when most common', () => {
    const text = "line1\r\nline2\r\nline3";
    assert.strictEqual(detectLineEndings(text, 'utf8'), 'CRLF');
  });

  test('should detect CR when most common', () => {
    const text = "line1\rline2\rline3";
    assert.strictEqual(detectLineEndings(text, 'utf8'), 'CR');
  });

  test('should detect LF when most common', () => {
    const text = "line1\nline2\nline3";
    assert.strictEqual(detectLineEndings(text, 'utf8'), 'LF');
  });

  test('should handle mixed line endings - CRLF dominant', () => {
    const text = "line1\r\nline2\nline3\r\nline4";
    // CRLF appears twice, LF once, CR zero times
    assert.strictEqual(detectLineEndings(text, 'utf8'), 'CRLF');
  });

  test('should handle mixed line endings - CR dominant', () => {
    const text = "line1\rline2\nline3\rline4";
    // CR appears twice, LF once, CRLF zero times
    assert.strictEqual(detectLineEndings(text, 'utf8'), 'CR');
  });

  test('should handle mixed line endings - LF dominant', () => {
    const text = "line1\nline2\rline3\nline4";
    // LF appears twice, CR once, CRLF zero times
    assert.strictEqual(detectLineEndings(text, 'utf8'), 'LF');
  });

  test('should handle equal counts properly', () => {
    const text = "line1\r\nline2\nline3"; // CRLF=1, LF=1, CR=0
    assert.strictEqual(detectLineEndings(text, 'utf8'), 'LF');
  });

  test('should default to LF for empty string', () => {
    assert.strictEqual(detectLineEndings('', 'utf8'), 'LF');
  });

  test('should default to LF when there are no line endings', () => {
    const text = "line1 line2 line3";
    assert.strictEqual(detectLineEndings(text, 'utf8'), 'LF');
  });

  test('should count CRLF as CRLF only, not as separate CR or LF', () => {
    const text = "line1\r\nline2";
    assert.strictEqual(detectLineEndings(text, 'utf8'), 'CRLF');
  });

  test('should prefer CR when CR ties CRLF and beats LF', () => {
    const text = "line1\r\nline2\rline3";
    assert.strictEqual(detectLineEndings(text, 'utf8'), 'CR');
  });

  test('should not change detection based on encoding argument', () => {
    const text = "line1\r\nline2\r\nline3";
    assert.strictEqual(detectLineEndings(text, 'utf16le'), 'CRLF');
  });

  test('should handle Windows-style text', () => {
    const text = "header\r\nvalue1\r\nvalue2\r\n";
    assert.strictEqual(detectLineEndings(text, 'utf8'), 'CRLF');
  });

  test('should handle Unix-style text', () => {
    const text = "header\nvalue1\nvalue2\n";
    assert.strictEqual(detectLineEndings(text, 'utf8'), 'LF');
  });

  test('should handle Mac-style text', () => {
    const text = "header\rvalue1\rvalue2\r";
    assert.strictEqual(detectLineEndings(text, 'utf8'), 'CR');
  });
});
