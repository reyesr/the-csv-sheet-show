import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import { EventEmitter } from 'events';
import { CsvFileConfig } from '../csv/CsvFileConfig';
import { detectConfig } from '../csv/detectConfig';
import { CsvLoadErrorReason } from '../shared/messages/errors';

export interface CsvMappingReaderStats {
	rowCount: number;
	readableRowCount: number;
	totalBytesRead: number;
	totalSizeInBytes: number;
	config: CsvFileConfig;
	isFinal: boolean;
}

export interface CsvMappingHeaderEventStruct {
	content: Buffer | string;
	config: CsvFileConfig;
}

/**
 * Resolves a previously saved config for a file from its first chunk of data, used as the hint for
 * `detectConfig`. Returns `undefined` when nothing is saved. `filepath` is the fsPath being opened.
 */
export type DetectExistingConfig = (filepath: string, initialDataChunk: Buffer) => CsvFileConfig | undefined;

export class CsvMappingReaderError extends Error {
	public constructor(message: string, public readonly reason: CsvLoadErrorReason) {
		super(message);
		this.name = 'CsvMappingReaderError';
	}
}

/** Reads large CSV files incrementally and maps each CSV row to its byte offset for paged access. */
export class CsvMappingReader extends EventEmitter {
	public static readonly DEFAULT_CHUNK_SIZE = 512 * 1024;
	public static readonly MAX_BYTES_WITHOUT_LINE_ENDING = 1024 * 1024;

	private mapping: number[] = [];
	private config: CsvFileConfig | null = null;
	private pendingConfig: CsvFileConfig | null = null;
	private filepath: string | null = null;
	private totalBytesRead = 0;
	private totalSizeInBytes = 0;
	private inQuotedCell = false;
	private pendingQuotedQuote = false;
	private lineEndingMatchCount = 0;
	private lineEndingMatchLength = 0;
	private activeStream: fs.ReadStream | null = null;
	private openGeneration = 0;
	private readonly chunkSize: number;
	private readonly firstPageRowCount: number;
	private hasEmittedFirstPage = false;
	private hasEmittedHeaders = false;
	private isFinal = false;
	private detectExistingConfig: DetectExistingConfig | undefined;

	public constructor(chunkSize = CsvMappingReader.DEFAULT_CHUNK_SIZE, firstPageRowCount = 1000, detectExistingConfig?: DetectExistingConfig) {
		super();
		this.chunkSize = chunkSize;
		this.firstPageRowCount = firstPageRowCount;
		this.detectExistingConfig = detectExistingConfig;
	}

	/** Set config to use for the next call to open(). Consumed by reset() and takes precedence over auto-detection. */
	public setOpenConfig(config: CsvFileConfig): void {
		this.pendingConfig = config;
	}

	public open(filepath: string): void {
		const generation = this.beginOpen();
		this.reset(filepath);
		this.totalSizeInBytes = fs.statSync(filepath).size;

		if (this.totalSizeInBytes === 0) {
			this.config = detectConfig(Buffer.alloc(0), undefined);
			this.isFinal = true;
			this.emitFirstPageIfNeeded(true);
			this.emit('end', this.createStats(true));
			return;
		}

		this.mapping.push(0);

		const stream = fs.createReadStream(filepath, { highWaterMark: this.chunkSize });
		this.activeStream = stream;

		let chunkIndex = 0;
		stream.on('data', (chunk: Buffer | string) => {
			if (!this.isActiveStream(stream, generation)) {
				return;
			}

			try {
				if (chunkIndex === 0) {
					// A config forced via setOpenConfig() (reset() put it in this.config) takes precedence
					// over auto-detection — only detect when none was forced (the normal open path).
					if (this.config === null) {
						const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
						const hint = this.detectExistingConfig?.(filepath, chunkBuffer) ?? undefined;
						this.config = detectConfig(chunkBuffer, hint);
					}
					this.emit('config', this.config);
				}
				this.processChunk(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
				if (this.shouldAbortForMissingLineEnding()) {
					stream.destroy(new CsvMappingReaderError(
						`No selected line ending was found in the first ${CsvMappingReader.MAX_BYTES_WITHOUT_LINE_ENDING} bytes.`,
						CsvLoadErrorReason.SelectedLineEndingNotFound
					));
					return;
				}

				this.emitHeadersIfNeeded();
				this.emitFirstPageIfNeeded(false);
				this.emit('stats', this.createStats(false));
				chunkIndex += 1;
			} catch (error) {
				stream.destroy(error instanceof Error ? error : new Error(String(error)));
			}
		});

		stream.on('end', () => {
			if (!this.isActiveStream(stream, generation)) {
				return;
			}

			this.activeStream = null;
			this.isFinal = true;
			this.emitHeadersIfNeeded(true);
			this.emitFirstPageIfNeeded(true);
			this.emit('end', this.createStats(true));
		});

		stream.on('error', error => {
			if (!this.isActiveStream(stream, generation)) {
				return;
			}

			this.activeStream = null;
			this.emit('error', error);
		});

		stream.on('close', () => {
			if (this.activeStream === stream) {
				this.activeStream = null;
			}
		});
	}

	/**
	 * Cancel any in-flight indexing and detach all listeners. Final teardown only — call from the
	 * owning document's dispose(); the reader is unusable afterward.
	 */
	public dispose(): void {
		this.openGeneration += 1;       // any queued stream callbacks bail via isActiveStream()
		this.cancelActiveStream();      // destroys activeStream (already sets it to null)
		this.removeAllListeners();      // drop the document's stats/end/headers/config listeners
	}

	public readRange(rowOffset: number, rowCount: number): string[] {
		if (this.filepath === null || this.config === null) {
			throw new Error('CSV file is not open');
		}

		if (rowOffset < 0 || rowCount < 0 || !Number.isInteger(rowOffset) || !Number.isInteger(rowCount)) {
			throw new Error('rowOffset and rowCount must be positive integers');
		}

		if (!this.canReadRange(rowOffset, rowCount)) {
			throw new Error(`CSV rows ${rowOffset}-${rowOffset + rowCount} are not available yet`);
		}

		if (rowCount === 0 || rowOffset >= this.mapping.length) {
			return [];
		}

		const endRow = Math.min(rowOffset + rowCount, this.mapping.length);
		const start = this.mapping[rowOffset];
		const end = endRow < this.mapping.length ? this.mapping[endRow] : this.totalSizeInBytes;
		const length = end - start;

		if (length <= 0) {
			return [];
		}

		const file = fs.openSync(this.filepath, 'r');
		try {
			const buffer = Buffer.allocUnsafe(length);
			fs.readSync(file, buffer, 0, length, start);
			return this.splitRows(this.decode(buffer)).slice(0, rowCount);
		} finally {
			fs.closeSync(file);
		}
	}

	public getMapping(): readonly number[] {
		return this.mapping;
	}

	public getTotalSizeInBytes(): number {
		return this.totalSizeInBytes;
	}

	public getConfig(): CsvFileConfig | null {
		return this.config;
	}

	public getReadableRowCount(): number {
		if (this.isFinal) {
			return this.mapping.length;
		}

		return Math.max(0, this.mapping.length - 1);
	}

	public canReadRange(rowOffset: number, rowCount: number): boolean {
		if (rowOffset < 0 || rowCount < 0 || !Number.isInteger(rowOffset) || !Number.isInteger(rowCount)) {
			return false;
		}

		if (this.isFinal) {
			return rowCount === 0 || rowOffset < this.getReadableRowCount();
		}

		return rowOffset + rowCount <= this.getReadableRowCount();
	}

	private reset(filepath: string): void {
		this.filepath = filepath;
		this.mapping = [];
		this.config = this.pendingConfig;
		this.pendingConfig = null;
		this.totalBytesRead = 0;
		this.totalSizeInBytes = 0;
		this.inQuotedCell = false;
		this.pendingQuotedQuote = false;
		this.lineEndingMatchCount = 0;
		this.lineEndingMatchLength = 0;
		this.hasEmittedFirstPage = false;
		this.hasEmittedHeaders = false;
		this.isFinal = false;
	}

	private beginOpen(): number {
		this.cancelActiveStream();
		this.openGeneration += 1;
		return this.openGeneration;
	}

	private cancelActiveStream(): void {
		if (this.activeStream === null) {
			return;
		}

		const stream = this.activeStream;
		this.activeStream = null;
		stream.destroy();
	}

	private isActiveStream(stream: fs.ReadStream, generation: number): boolean {
		return this.activeStream === stream && this.openGeneration === generation;
	}

	private emitFirstPageIfNeeded(isFinal: boolean): void {
		if (this.hasEmittedFirstPage) {
			return;
		}

		if (this.mapping.length >= this.firstPageRowCount || isFinal) {
			this.hasEmittedFirstPage = true;
			this.emit('first-page', this.createStats(isFinal));
		}
	}

	private emitHeadersIfNeeded(isFinal = false): void {
		if (this.hasEmittedHeaders || this.config === null || !this.config.hasHeader || this.filepath === null) {
			return;
		}

		const headerStart = this.mapping[0];
		const headerEnd = this.mapping.length > 1 ? this.mapping[1] : (isFinal ? this.totalSizeInBytes : -1);
		const length = headerEnd - headerStart;
		if (length <= 0) {
			return;
		}

		const file = fs.openSync(this.filepath, 'r');
		try {
			const headerContent = Buffer.allocUnsafe(length);
			fs.readSync(file, headerContent, 0, length, headerStart);
			this.hasEmittedHeaders = true;
			this.emit('headers', { content: headerContent, config: this.config } satisfies CsvMappingHeaderEventStruct);
		} finally {
			fs.closeSync(file);
		}
	}

	private processChunk(chunk: Buffer): void {
		this.updateMapping(chunk, this.totalBytesRead);
		this.totalBytesRead += chunk.length;
	}

	private shouldAbortForMissingLineEnding(): boolean {
		return this.totalSizeInBytes > CsvMappingReader.MAX_BYTES_WITHOUT_LINE_ENDING
			&& this.totalBytesRead >= CsvMappingReader.MAX_BYTES_WITHOUT_LINE_ENDING
			&& this.lineEndingMatchCount === 0;
	}

	private updateMapping(chunk: Buffer, chunkOffset: number): void {
		const lineEnding = Buffer.from(this.configOrThrow().lineEnding, 'ascii');
		const prefixTable = this.buildLineEndingPrefixTable(lineEnding);

		for (let i = 0; i < chunk.length; i++) {
			const byte = chunk[i];
			const absoluteOffset = chunkOffset + i;

			if (this.pendingQuotedQuote) {
				if (byte === 34) {
					this.resetLineEndingMatch();
					this.pendingQuotedQuote = false;
					continue;
				}

				this.inQuotedCell = false;
				this.pendingQuotedQuote = false;
			}

			if (byte === 34) {
				this.resetLineEndingMatch();
				if (this.processQuote(chunk, i)) {
					i += 1;
				}
				continue;
			}

			if (!this.inQuotedCell && this.advanceLineEndingMatch(byte, lineEnding, prefixTable)) {
				this.recordLineEndingMatch(absoluteOffset + 1);
			}
		}
	}

	private recordLineEndingMatch(nextRowOffset: number): void {
		this.lineEndingMatchCount += 1;
		this.mapping.push(nextRowOffset);
	}

	private advanceLineEndingMatch(byte: number, lineEnding: Buffer, prefixTable: number[]): boolean {
		if (lineEnding.length === 0) {
			return false;
		}

		while (this.lineEndingMatchLength > 0 && byte !== lineEnding[this.lineEndingMatchLength]) {
			this.lineEndingMatchLength = prefixTable[this.lineEndingMatchLength - 1];
		}

		if (byte !== lineEnding[this.lineEndingMatchLength]) {
			return false;
		}

		this.lineEndingMatchLength += 1;
		if (this.lineEndingMatchLength < lineEnding.length) {
			return false;
		}

		this.resetLineEndingMatch();
		return true;
	}

	private resetLineEndingMatch(): void {
		this.lineEndingMatchLength = 0;
	}

	private buildLineEndingPrefixTable(lineEnding: Buffer): number[] {
		const prefixTable = new Array<number>(lineEnding.length).fill(0);
		let prefixLength = 0;

		for (let i = 1; i < lineEnding.length; i++) {
			while (prefixLength > 0 && lineEnding[i] !== lineEnding[prefixLength]) {
				prefixLength = prefixTable[prefixLength - 1];
			}

			if (lineEnding[i] === lineEnding[prefixLength]) {
				prefixLength += 1;
				prefixTable[i] = prefixLength;
			}
		}

		return prefixTable;
	}

	private processQuote(chunk: Buffer, index: number): boolean {
		if (!this.inQuotedCell) {
			this.inQuotedCell = true;
			return false;
		}

		if (index + 1 < chunk.length) {
			if (chunk[index + 1] === 34) {
				return true;
			}

			this.inQuotedCell = false;
			return false;
		}

		this.pendingQuotedQuote = true;
		return false;
	}

	private splitRows(content: string): string[] {
		const lineEnding = this.configOrThrow().lineEnding;
		const rows: string[] = [];
		let rowStart = 0;
		let inQuotedCell = false;

		for (let i = 0; i < content.length; i++) {
			if (content[i] === '"') {
				if (inQuotedCell && content[i + 1] === '"') {
					i += 1;
				} else {
					inQuotedCell = !inQuotedCell;
				}
				continue;
			}

			if (!inQuotedCell && content.startsWith(lineEnding, i)) {
				rows.push(content.slice(rowStart, i));
				i += lineEnding.length - 1;
				rowStart = i + 1;
			}
		}

		if (rowStart < content.length) {
			rows.push(content.slice(rowStart));
		}

		return rows;
	}

	private decode(buffer: Buffer): string {
		return iconv.decode(buffer, this.configOrThrow().encoding);
	}

	private createStats(isFinal: boolean): CsvMappingReaderStats {
		let rowCount = this.mapping.length;

		// If the last byte of the file is a line ending, the mapping will contain an extra entry for the end of the file that is actually not a row
		if (this.mapping.length > 0 && this.mapping[this.mapping.length - 1] === this.totalSizeInBytes) {
			rowCount -= 1;
		}

		return {
			rowCount,
			readableRowCount: this.getReadableRowCount(),
			totalBytesRead: this.totalBytesRead,
			totalSizeInBytes: this.totalSizeInBytes,
			config: this.configOrThrow(),
			isFinal
		};
	}

	private configOrThrow(): CsvFileConfig {
		if (this.config === null) {
			throw new Error('CSV config is not available');
		}

		return this.config;
	}
}
