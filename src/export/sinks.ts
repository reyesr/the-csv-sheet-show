import * as fs from 'fs';
import * as vscode from 'vscode';
import type { ExportSink, ExportSinkResult } from './types';

/** Soft cap on clipboard exports — beyond this, callers should write a file instead (§3.7). */
export const CLIPBOARD_SOFT_CAP_BYTES = 50 * 1024 * 1024;

/** Streams UTF-8 text to a file; memory stays bounded via `drain()`. */
export class FileSink implements ExportSink {
	private readonly stream: fs.WriteStream;
	private byteCount = 0;
	private finalized = false;
	/** True when the last write() returned false (buffer over highWaterMark) and a 'drain' is pending. */
	private needsDrain = false;

	public constructor(private readonly filePath: string) {
		this.stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
	}

	public write(chunk: string): void {
		this.byteCount += Buffer.byteLength(chunk, 'utf8');
		// write() returns false only once the buffer exceeds highWaterMark; a 'drain' event is then
		// emitted when it is safe to write again. For writes under the watermark it returns true and
		// NO 'drain' fires — so we must only await 'drain' when write() actually signalled backpressure.
		this.needsDrain = !this.stream.write(chunk);
	}

	public drain(): Promise<void> {
		if (!this.needsDrain) {
			return Promise.resolve();
		}
		return new Promise(resolve => this.stream.once('drain', () => {
			this.needsDrain = false;
			resolve();
		}));
	}

	public finalize(): Promise<ExportSinkResult> {
		this.finalized = true;
		return new Promise((resolve, reject) => {
			this.stream.end((error?: Error | null) => {
				if (error) {
					reject(error);
					return;
				}
				resolve({ byteCount: this.byteCount, filePath: this.filePath });
			});
		});
	}

	public async dispose(): Promise<void> {
		// Close the stream and remove the partial file (best effort).
		await new Promise<void>(resolve => {
			if (this.finalized) {
				resolve();
				return;
			}
			this.stream.destroy();
			this.stream.once('close', () => resolve());
			this.stream.once('error', () => resolve());
		});
		try {
			await fs.promises.unlink(this.filePath);
		} catch {
			// The file may not exist yet — nothing to clean up.
		}
	}
}

/** Accumulates text in memory and writes it to the system clipboard on finalize. */
export class ClipboardSink implements ExportSink {
	private readonly chunks: string[] = [];
	private byteCount = 0;

	public write(chunk: string): void {
		this.byteCount += Buffer.byteLength(chunk, 'utf8');
		if (this.byteCount > CLIPBOARD_SOFT_CAP_BYTES) {
			throw new Error('Export is too large for the clipboard. Export to a file instead.');
		}
		this.chunks.push(chunk);
	}

	public drain(): Promise<void> {
		return Promise.resolve();
	}

	public async finalize(): Promise<ExportSinkResult> {
		const text = this.chunks.join('');
		await vscode.env.clipboard.writeText(text);
		return { byteCount: this.byteCount };
	}

	public dispose(): Promise<void> {
		this.chunks.length = 0;
		return Promise.resolve();
	}
}
