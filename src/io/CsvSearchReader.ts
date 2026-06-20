import { EventEmitter } from 'events';
import { CsvMappingReader } from './CsvMappingReader';

export interface CsvSearchOptions {
	matchCase: boolean;
	regex: boolean;
	wholeWord?: boolean;
}

/** A single match occurrence inside a cell. `rowIndex` carries the filtered-grid index of the row. */
export interface CsvSearchMatch {
	rowIndex: number;
	cellIndex: number;
	start: number;
	end: number;
}

/** A matching row streamed to the consumer: its values plus the per-cell match ranges. */
export interface CsvSearchRow {
	/** Displayed-row offset (header excluded, edits applied) — the original file row number. */
	offset: number;
	cells: string[];
	/** Per-cell matches; each carries `rowIndex` = the filtered-grid index of this row. */
	matches: CsvSearchMatch[];
}

/** Emitted once per processed chunk (and once more, empty, if the scan finishes without a trailing chunk). */
export interface CsvSearchUpdate {
	/** Total matching rows found so far (= matchingRows.length). */
	totalCount: number;
	/** Bytes of the file read so far, for progress display. */
	bytesProcessed: number;
	/** Total file size in bytes. */
	totalBytes: number;
	/** This chunk's matching rows with data; `[]` once `initialRowsExpected` has been satisfied. */
	rows: CsvSearchRow[];
	/** True on the final update (all scan passes exhausted while the file is final). */
	isFinal: boolean;
}

export interface CsvSearchReaderConfig {
	/**
	 * Number of matching rows whose full data is streamed for the consumer's initial display.
	 * Beyond this, offsets keep accumulating in matchingRows but `rows` is sent empty; the
	 * consumer pages the remainder on demand from getMatchingRows().
	 */
	initialRowsExpected: number;
	/**
	 * Displayed-row offset to begin scanning from. The scan runs forward to the end of the file,
	 * then WRAPS to row 0 and continues up to startFromRow so the whole file is covered. Defaults
	 * to 0 (no wrap).
	 */
	startFromRow?: number;
	/** Restrict matching to these column indices; empty/undefined = all columns. */
	selectedColumns?: number[];
	/**
	 * Reads displayed rows (header excluded, pending edits applied) as cell arrays. Injected by the
	 * consumer so header-offset translation and pending-edit resolution live in one place; the
	 * CsvMappingReader is still used for streaming guards and the byte mapping.
	 */
	readRows: (offset: number, count: number) => string[][];
}

interface CsvSearchReaderEvents {
	update: [CsvSearchUpdate];
	done: [];
	error: [Error];
}

export declare interface CsvSearchReader {
	on<K extends keyof CsvSearchReaderEvents>(event: K, listener: (...args: CsvSearchReaderEvents[K]) => void): this;
	on(event: string, listener: (...args: unknown[]) => void): this;
	once<K extends keyof CsvSearchReaderEvents>(event: K, listener: (...args: CsvSearchReaderEvents[K]) => void): this;
	once(event: string, listener: (...args: unknown[]) => void): this;
	emit<K extends keyof CsvSearchReaderEvents>(event: K, ...args: CsvSearchReaderEvents[K]): boolean;
	emit(event: string, ...args: unknown[]): boolean;
}

/**
 * Streaming search engine. Configured once, it is driven forward by `searchAvailableRows` (called by
 * the consumer from the mapping reader's stats/end events). It scans newly-readable rows in
 * time-budgeted batches that yield to the event loop via `setImmediate`, accumulating every matching
 * row's offset into `matchingRows` and emitting one `update` per processed chunk.
 */
export class CsvSearchReader extends EventEmitter {
	public static readonly MAX_PAGE_ROW_COUNT = 10_000;
	public static readonly SCAN_BUDGET_MS = 8;

	private readonly matcher: CellMatcher;
	private readonly selectedColumns: Set<number> | null;
	private readonly initialRowsExpected: number;
	private readonly startFromRow: number;
	private readonly readRows: (offset: number, count: number) => string[][];

	private readonly matchingRows: number[] = [];
	private streamedRowCount = 0;
	private scanCursor: number;
	private wrapCursor = 0;
	private phase: 'forward' | 'wrap' | 'done' = 'forward';
	private isCancelled = false;
	private isPumping = false;
	private readableRowCount = 0;
	private isFinalKnown = false;
	private lastEmittedFinal = false;

	public constructor(
		private readonly reader: CsvMappingReader,
		query: string,
		options: CsvSearchOptions,
		config: CsvSearchReaderConfig
	) {
		super();
		this.matcher = createCellMatcher(query, options); // throws synchronously on an invalid regex
		this.initialRowsExpected = Math.max(0, config.initialRowsExpected);
		this.startFromRow = Math.max(0, config.startFromRow ?? 0);
		this.selectedColumns = config.selectedColumns !== undefined && config.selectedColumns.length > 0
			? new Set(config.selectedColumns)
			: null;
		this.readRows = config.readRows;
		this.scanCursor = this.startFromRow;
	}

	/** Complete list of every matching row's displayed offset, in scan order; no size limit. */
	public getMatchingRows(): readonly number[] {
		return this.matchingRows;
	}

	public isComplete(): boolean {
		return this.phase === 'done';
	}

	public cancel(): void {
		this.isCancelled = true;
	}

	/**
	 * Entry point — cheap and non-blocking. Records the latest readable bound and ensures the pump is
	 * running; the actual scanning is paced by `pump()`, which yields between batches.
	 */
	public searchAvailableRows(readableRowCount: number, isFinal: boolean): void {
		if (readableRowCount > this.readableRowCount) {
			this.readableRowCount = readableRowCount;
		}
		if (isFinal) {
			this.isFinalKnown = true;
		}
		if (this.isCancelled || this.phase === 'done') {
			return;
		}
		if (!this.isPumping) {
			this.isPumping = true;
			setImmediate(() => this.pump());
		}
	}

	private pump(): void {
		if (this.isCancelled) {
			this.isPumping = false;
			return;
		}

		try {
			const deadline = Date.now() + CsvSearchReader.SCAN_BUDGET_MS;
			while (Date.now() < deadline) {
				const range = this.nextScanRange();
				if (range === null) {
					break;
				}
				const rows = this.readRows(range.start, range.length);
				this.processChunk(range.start, rows);
				if (this.isCancelled) {
					this.isPumping = false;
					return;
				}
			}
		} catch (error) {
			this.phase = 'done';
			this.isPumping = false;
			this.emit('error', error instanceof Error ? error : new Error(String(error)));
			return;
		}

		if (this.isCancelled) {
			this.isPumping = false;
			return;
		}

		if (this.hasMoreToScan()) {
			setImmediate(() => this.pump()); // yield, then continue next tick
			return;
		}

		if (this.isFinalKnown) {
			this.phase = 'done';
			if (!this.lastEmittedFinal) {
				// The scan finished without a trailing matching chunk (e.g. zero rows): emit a final ping.
				this.lastEmittedFinal = true;
				this.emit('update', {
					totalCount: this.matchingRows.length,
					bytesProcessed: this.reader.getTotalSizeInBytes(),
					totalBytes: this.reader.getTotalSizeInBytes(),
					rows: [],
					isFinal: true
				});
			}
			this.isPumping = false;
			this.emit('done');
			return;
		}

		this.isPumping = false; // idle until the next searchAvailableRows() advances the bound
	}

	/** Advances and returns the next chunk range to read, or null when nothing is readable right now. */
	private nextScanRange(): { start: number; length: number } | null {
		if (this.phase === 'forward') {
			if (this.scanCursor < this.readableRowCount) {
				const start = this.scanCursor;
				const length = Math.min(CsvSearchReader.MAX_PAGE_ROW_COUNT, this.readableRowCount - start);
				this.scanCursor += length;
				return { start, length };
			}

			// Forward pass caught up to the current readable bound.
			if (this.isFinalKnown) {
				if (this.startFromRow > 0 && this.wrapCursor < this.startFromRow) {
					this.phase = 'wrap';
					return this.nextScanRange();
				}
				this.phase = 'done';
			}
			return null;
		}

		if (this.phase === 'wrap') {
			if (this.wrapCursor < this.startFromRow) {
				const start = this.wrapCursor;
				const length = Math.min(CsvSearchReader.MAX_PAGE_ROW_COUNT, this.startFromRow - start);
				this.wrapCursor += length;
				return { start, length };
			}
			this.phase = 'done';
			return null;
		}

		return null;
	}

	/** True if more rows remain to scan given the current bounds (non-mutating). */
	private hasMoreToScan(): boolean {
		if (this.phase === 'forward') {
			if (this.scanCursor < this.readableRowCount) {
				return true;
			}
			return this.isFinalKnown && this.startFromRow > 0 && this.wrapCursor < this.startFromRow;
		}
		if (this.phase === 'wrap') {
			return this.wrapCursor < this.startFromRow;
		}
		return false;
	}

	private processChunk(chunkStart: number, rows: string[][]): void {
		const chunkRows: CsvSearchRow[] = [];

		for (let i = 0; i < rows.length; i++) {
			const cells = rows[i];
			const offset = chunkStart + i;
			const gridIndex = this.matchingRows.length; // the grid index this row would receive
			const matches: CsvSearchMatch[] = [];

			for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
				if (this.selectedColumns !== null && !this.selectedColumns.has(cellIndex)) {
					continue;
				}
				for (const range of this.matcher.findMatches(cells[cellIndex])) {
					matches.push({ rowIndex: gridIndex, cellIndex, start: range.start, end: range.end });
				}
			}

			if (matches.length > 0) {
				this.matchingRows.push(offset);
				chunkRows.push({ offset, cells, matches });
			}
		}

		let rowsToSend: CsvSearchRow[] = [];
		if (this.streamedRowCount < this.initialRowsExpected) {
			const remaining = this.initialRowsExpected - this.streamedRowCount;
			rowsToSend = chunkRows.length <= remaining ? chunkRows : chunkRows.slice(0, remaining);
			this.streamedRowCount += rowsToSend.length;
		}

		const isFinal = this.isFinalKnown && !this.hasMoreToScan();
		this.lastEmittedFinal = isFinal;
		this.emit('update', {
			totalCount: this.matchingRows.length,
			bytesProcessed: this.computeBytesProcessed(),
			totalBytes: this.reader.getTotalSizeInBytes(),
			rows: rowsToSend,
			isFinal
		});
	}

	private computeBytesProcessed(): number {
		const totalBytes = this.reader.getTotalSizeInBytes();
		if (this.phase === 'wrap') {
			return totalBytes;
		}
		const mapping = this.reader.getMapping();
		const headerOffset = this.reader.getConfig()?.hasHeader === true ? 1 : 0;
		const physicalRow = this.scanCursor + headerOffset;
		return physicalRow < mapping.length ? mapping[physicalRow] : totalBytes;
	}
}

export interface CellMatchRange {
	start: number;
	end: number;
}

export interface CellMatcher {
	findMatches(value: string): CellMatchRange[];
}

export function createCellMatcher(query: string, options: CsvSearchOptions): CellMatcher {
	if (query.length === 0) {
		return { findMatches: () => [] };
	}

	if (options.regex) {
		const flags = options.matchCase ? 'g' : 'gi';
		const regex = new RegExp(query, flags);
		return { findMatches: value => findRegexMatches(value, regex, options.wholeWord === true) };
	}

	const needle = options.matchCase ? query : query.toLocaleLowerCase();
	return {
		findMatches(value) {
			const haystack = options.matchCase ? value : value.toLocaleLowerCase();
			const matches: CellMatchRange[] = [];
			let start = 0;

			while (start <= haystack.length) {
				const index = haystack.indexOf(needle, start);
				if (index === -1) {
					break;
				}

				const end = index + query.length;
				if (options.wholeWord !== true || isWholeWordMatch(value, index, end)) {
					matches.push({ start: index, end });
				}
				start = index + Math.max(needle.length, 1);
			}

			return matches;
		}
	};
}

function findRegexMatches(value: string, regex: RegExp, wholeWord: boolean): CellMatchRange[] {
	const matches: CellMatchRange[] = [];
	regex.lastIndex = 0;

	while (true) {
		const match = regex.exec(value);
		if (match === null) {
			break;
		}

		if (match[0].length === 0) {
			regex.lastIndex += 1;
			continue;
		}

		const end = match.index + match[0].length;
		if (!wholeWord || isWholeWordMatch(value, match.index, end)) {
			matches.push({ start: match.index, end });
		}
	}

	return matches;
}

function isWholeWordMatch(value: string, start: number, end: number): boolean {
	return !isWordCharacter(value[start - 1]) && !isWordCharacter(value[end]);
}

function isWordCharacter(value: string | undefined): boolean {
	return value !== undefined && /[A-Za-z0-9_]/.test(value);
}
