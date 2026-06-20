/// <reference types="mocha" />
import * as assert from 'assert';
import * as iconv from 'iconv-lite';
import { detectBufferEncoding, decodeBuffer } from '../../io/EncodingUtils';

suite('EncodingUtils', () => {
  test('detectBufferEncoding maps utf-8 and variants', () => {
    assert.strictEqual(detectBufferEncoding('utf-8'), 'utf8');
    assert.strictEqual(detectBufferEncoding('UTF8'), 'utf8');
  });

  test('detectBufferEncoding maps utf16 variants to utf16le', () => {
    assert.strictEqual(detectBufferEncoding('utf16'), 'utf16le');
    assert.strictEqual(detectBufferEncoding('UTF-16LE'), 'utf16le');
    assert.strictEqual(detectBufferEncoding('ucs-2'), 'utf16le');
  });

  test('detectBufferEncoding maps latin1/iso-8859-1', () => {
    assert.strictEqual(detectBufferEncoding('latin1'), 'latin1');
    assert.strictEqual(detectBufferEncoding('ISO-8859-1'), 'latin1');
  });

  test('detectBufferEncoding handles undefined and unknown', () => {
    assert.strictEqual(detectBufferEncoding(undefined), 'utf8');
    assert.strictEqual(detectBufferEncoding('some-unknown-encoding'), null);
  });

  test('decodeBuffer decodes utf8 buffers', () => {
    const s = 'hello ñ — café';
    const b = Buffer.from(s, 'utf8');
    assert.strictEqual(decodeBuffer(b), s);
  });

  test('decodeBuffer decodes provided windows-1252 buffer', () => {
    const s = 'café – €';
    const b = iconv.encode(s, 'windows-1252');
    assert.strictEqual(decodeBuffer(b, 'windows-1252'), s);
  });

  test('decodeBuffer autodetects windows-1252 (chardet fallback to iconv)', () => {
    const s = 'olá café';
    const b = iconv.encode(s, 'windows-1252');
    const out = decodeBuffer(b);
    assert.strictEqual(out, s);
  });

  test('decodeBuffer handles utf16le via buffer.toString mapping (explicit encoding)', () => {
    const s = 'こんにちは';
    const b = Buffer.from(s, 'utf16le');
    assert.strictEqual(decodeBuffer(b, 'utf16le'), s);
  });
});
