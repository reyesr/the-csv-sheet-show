/// <reference types="mocha" />
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileSink } from '../../export/sinks';
import type { ExportSinkResult } from '../../export/types';

/** Write chunks through a FileSink the way ExportService.drive does (drain after each write). */
async function writeViaFileSink(filePath: string, chunks: string[]): Promise<ExportSinkResult> {
	const sink = new FileSink(filePath);
	for (const chunk of chunks) {
		sink.write(chunk);
		await sink.drain();
	}
	return sink.finalize();
}

suite('FileSink', () => {
	let filePath = '';

	teardown(async () => {
		if (filePath !== '') {
			await fs.promises.rm(filePath, { force: true });
		}
	});

	test('small writes complete and flush the full content (regression: hung, dropped closing ])', async () => {
		filePath = path.join(os.tmpdir(), `csv-export-small-${Date.now()}.json`);
		// Mirrors a JSON export: begin, one row, end — each well under the 16 KB high-water mark.
		const result = await writeViaFileSink(filePath, ['[', '\n  { "id": 1 }', '\n]\n']);

		const written = await fs.promises.readFile(filePath, 'utf8');
		assert.strictEqual(written, '[\n  { "id": 1 }\n]\n');
		assert.ok(written.endsWith(']\n'), 'file must contain the closing bracket');
		assert.strictEqual(result.byteCount, Buffer.byteLength(written, 'utf8'));
		assert.strictEqual(result.filePath, filePath);
		assert.deepStrictEqual(JSON.parse(written), [{ id: 1 }]);
	});

	test('large writes that trigger backpressure still complete with exact content', async () => {
		filePath = path.join(os.tmpdir(), `csv-export-large-${Date.now()}.json`);
		// Many chunks well past the 16 KB high-water mark, so write() returns false and 'drain' fires.
		const chunks = ['['];
		for (let i = 0; i < 5000; i++) {
			chunks.push(`${i === 0 ? '' : ','}"row-${i}-padding-padding-padding"`);
		}
		chunks.push(']');
		const result = await writeViaFileSink(filePath, chunks);

		const written = await fs.promises.readFile(filePath, 'utf8');
		assert.strictEqual(written, chunks.join(''));
		assert.ok(written.endsWith(']'));
		assert.strictEqual(result.byteCount, Buffer.byteLength(written, 'utf8'));
		const parsed = JSON.parse(written) as string[];
		assert.strictEqual(parsed.length, 5000);
		assert.strictEqual(parsed[4999], 'row-4999-padding-padding-padding');
	});
});
