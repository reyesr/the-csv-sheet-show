import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import * as path from 'path';
import type { CsvDocumentChanges } from '../CsvDocumentChanges';
import type { CsvFileConfig } from '../csv/CsvFileConfig';
import { encodeCells } from '../csv/encodeCells';
import { splitCells } from '../csv/splitCells';
import { materializeHeaderNames } from '../shared/headerLabels';

/**
 * Everything the writer needs to materialize the current virtual document, supplied by the host so
 * the writer stays free of reader/paging concerns. Base (original-file) rows are copied verbatim;
 * edited, inserted and header rows are re-serialized from the change overlay.
 */
export interface CsvWriteSource {
	readonly config: CsvFileConfig;
	/** Virtual (displayed, edit-applied) data-row count to emit. */
	readonly totalRows: number;
	/** Path of the original file — probed for a trailing newline and used as the atomic-replace target. */
	readonly originalPath: string;
	/** Row block size for the streaming write loop. */
	readonly pageSize: number;
	/** The change overlay (header/base/inserted-row decorators). */
	readonly changes: CsvDocumentChanges;
	/** Read raw (undecorated) physical file rows. */
	readPhysical(physicalRow: number, count: number): string[];
	/** Map a displayed (data) row index to its physical file row. */
	displayedToPhysical(displayedRow: number): number;
}

/** One page of output lines (header line emitted in its own leading batch with dataRows: 0). */
interface CsvLineBatch {
	lines: string[];
	/** Data rows represented by this batch — drives progress reporting (the header counts as 0). */
	dataRows: number;
}

/**
 * Yield the virtual document's output lines page by page: the header (when present) first, then one
 * batch per `pageSize` block. Untouched base rows are copied as-is, edited/inserted rows are
 * re-serialized. Shared by the sync and progress-reporting writers so both emit identical bytes.
 */
function* iterateCsvLineBatches(source: CsvWriteSource): Generator<CsvLineBatch> {
	const { config, changes } = source;

	if (config.hasHeader) {
		const rawHeader = source.readPhysical(0, 1)[0] ?? '';
		yield {
			lines: [changes.hasHeaderEdits()
				? encodeCells(changes.decorateHeader(splitCells(rawHeader, config.separator)), config.separator)
				: rawHeader],
			dataRows: 0
		};
	} else if (changes.hasInsertedHeader()) {
		// A header added to a header-less file: prepend it, materializing unnamed cells to column_N.
		const insertedCells = changes.getInsertedHeaderCells() ?? [];
		yield {
			lines: [encodeCells(materializeHeaderNames(insertedCells, insertedCells.length), config.separator)],
			dataRows: 0
		};
	}

	for (let offset = 0; offset < source.totalRows;) {
		const count = Math.min(source.pageSize, source.totalRows - offset);
		const lines: string[] = [];
		for (const segment of changes.resolveSegments(offset, count)) {
			if (segment.kind === 'base') {
				const rawLines = source.readPhysical(source.displayedToPhysical(segment.baseStart), segment.length);
				for (let i = 0; i < rawLines.length; i++) {
					const baseRow = segment.baseStart + i;
					lines.push(changes.hasBaseRowEdit(baseRow)
						? encodeCells(changes.decorateBaseRow(baseRow, splitCells(rawLines[i], config.separator)), config.separator)
						: rawLines[i]);
				}
			} else {
				for (const id of segment.ids) {
					lines.push(encodeCells(changes.decorateInsertedRow(id), config.separator));
				}
			}
		}
		yield { lines, dataRows: count };
		offset += count;
	}
}

/** Build a line sink that prefixes every line after the first with the configured line ending. */
function createLineWriter(fd: number, config: CsvFileConfig): (line: string) => void {
	let isFirstLine = true;
	return (line: string): void => {
		const text = isFirstLine ? line : config.lineEnding + line;
		fs.writeSync(fd, encodeText(text, config.encoding));
		isFirstLine = false;
	};
}

/** Match the original file's trailing-newline presence so a no-op save leaves the bytes unchanged. */
function writeTrailingNewlineIfNeeded(fd: number, source: CsvWriteSource): void {
	if (originalEndsWithNewline(source.originalPath)) {
		fs.writeSync(fd, encodeText(source.config.lineEnding, source.config.encoding));
	}
}

/** Stream the virtual content to `targetPath`: untouched base rows copied as-is, edited/inserted rows re-serialized. */
export function writeCsv(targetPath: string, source: CsvWriteSource): void {
	const fd = fs.openSync(targetPath, 'w');
	try {
		const writeLine = createLineWriter(fd, source.config);
		for (const batch of iterateCsvLineBatches(source)) {
			for (const line of batch.lines) {
				writeLine(line);
			}
		}
		writeTrailingNewlineIfNeeded(fd, source);
	} finally {
		fs.closeSync(fd);
	}
}

/**
 * Like {@link writeCsv}, but `await`s a turn of the event loop after each page and reports
 * `onProgress(rowsWritten, totalRows)`. Yielding lets the extension flush queued `postMessage`s
 * (so a progress bar can animate) and keeps the host responsive on large files.
 */
export async function writeCsvWithProgress(
	targetPath: string,
	source: CsvWriteSource,
	onProgress: (rowsWritten: number, totalRows: number) => void
): Promise<void> {
	const fd = fs.openSync(targetPath, 'w');
	try {
		const writeLine = createLineWriter(fd, source.config);
		let rowsWritten = 0;
		for (const batch of iterateCsvLineBatches(source)) {
			for (const line of batch.lines) {
				writeLine(line);
			}
			rowsWritten += batch.dataRows;
			onProgress(rowsWritten, source.totalRows);
			await yieldToEventLoop();
		}
		writeTrailingNewlineIfNeeded(fd, source);
	} finally {
		fs.closeSync(fd);
	}
}

function tempPathFor(targetPath: string): string {
	return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.csv-sheet-show.tmp`);
}

/**
 * Atomically replace `targetPath` with the temp file, falling back to copy when rename is rejected
 * (Windows can reject a rename over a locked/open target with EPERM/EBUSY).
 */
function replaceWithTemp(tempPath: string, targetPath: string): void {
	try {
		fs.renameSync(tempPath, targetPath);
	} catch (error) {
		try {
			fs.copyFileSync(tempPath, targetPath);
			fs.unlinkSync(tempPath);
		} catch (fallbackError) {
			throw new Error(`Failed to save CSV file: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
		}
	}
}

/** Write to a temp file then atomically replace `targetPath`. */
export function writeCsvAndReplace(targetPath: string, source: CsvWriteSource): void {
	const tempPath = tempPathFor(targetPath);
	writeCsv(tempPath, source);
	replaceWithTemp(tempPath, targetPath);
}

/** Progress-reporting counterpart of {@link writeCsvAndReplace} (see {@link writeCsvWithProgress}). */
export async function writeCsvAndReplaceWithProgress(
	targetPath: string,
	source: CsvWriteSource,
	onProgress: (rowsWritten: number, totalRows: number) => void
): Promise<void> {
	const tempPath = tempPathFor(targetPath);
	await writeCsvWithProgress(tempPath, source, onProgress);
	replaceWithTemp(tempPath, targetPath);
}

function yieldToEventLoop(): Promise<void> {
	return new Promise(resolve => setImmediate(resolve));
}

function originalEndsWithNewline(filePath: string): boolean {
	const size = fs.statSync(filePath).size;
	if (size === 0) {
		return false;
	}

	const fd = fs.openSync(filePath, 'r');
	try {
		const buffer = Buffer.alloc(1);
		fs.readSync(fd, buffer, 0, 1, size - 1);
		return buffer[0] === 0x0a || buffer[0] === 0x0d;
	} finally {
		fs.closeSync(fd);
	}
}

function encodeText(text: string, encoding: string): Buffer {
	return iconv.encode(text, encoding);
}
