import type { InvalidatedRange } from './shared/messages/editing';

/**
 * The closed set of atomic operations the change log can contain.
 * Indices are *virtual* (the logical view after all prior changes are applied in order).
 */
export type Change =
	| { changeId: number; type: 'set-cell-content'; data: { rowIndex: number; columnIndex: number; value: string } }
	| { changeId: number; type: 'set-header-content'; data: { columnIndex: number; value: string } }
	| { changeId: number; type: 'insert-header'; data: { cells: string[] } }
	| { changeId: number; type: 'remove-header' }
	| { changeId: number; type: 'insert-row'; data: { rowIndex: number } }
	| { changeId: number; type: 'delete-row-range'; data: { offset: number; count: number } };

export type OperationType = Change['type'];

/**
 * A resolved span of a virtual range, pointing either at a contiguous run of base
 * (file-backed) rows or at a run of in-memory inserted rows. Returned in virtual order.
 */
export type ResolvedSegment =
	| { kind: 'base'; baseStart: number; length: number }
	| { kind: 'inserted'; ids: number[] };

/** Reads and splits a contiguous run of base (original-file) rows into cells. */
export type BaseRowReader = (baseStart: number, length: number) => string[][];

interface BaseSegment {
	kind: 'base';
	virtualStart: number;
	length: number;
	baseStart: number;
}

interface InsertedSegment {
	kind: 'inserted';
	virtualStart: number;
	length: number;
	ids: number[];
}

type Segment = BaseSegment | InsertedSegment;

const BASE_TAIL = Number.POSITIVE_INFINITY;

/**
 * Owns the change log and the derived overlay used to serve a virtual view of the document
 * without ever mutating the underlying file.
 *
 * Operates entirely in *displayed-row* (virtual) space: it knows nothing about the header row
 * or byte offsets — that translation stays in CsvDocument. See local/features/editing.md.
 */
export class CsvDocumentChanges {
	private log: Change[] = [];
	private redoStack: Change[] = [];
	private nextChangeId = 1;

	// Derived overlay (rebuilt from the log).
	private segments: Segment[] = [];
	// Cell edits keyed by stable row identity -> (column index -> value), so edits survive row shifts.
	private cellEdits = new Map<RowIdentity, Map<number, string>>();
	// Header cell edits (the single header row), keyed by column index.
	private headerEdits = new Map<number, string>();
	// A header row added to a header-less file (empty strings = unnamed columns). null when the file
	// either has a real (file-backed) header or no header at all. Edits overlay on top via headerEdits.
	private insertedHeader: string[] | null = null;
	private insertedRows = new Map<number, string[]>();
	private nextInsertedId = 1;
	private rowCountDelta = 0;

	public constructor() {
		this.rebuild();
	}

	public hasChanges(): boolean {
		return this.log.length > 0;
	}

	public canUndo(): boolean {
		return this.log.length > 0;
	}

	public canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	/** Virtual readable row count = base readable count adjusted by inserts/deletes. */
	public getRowCountDelta(): number {
		return this.rowCountDelta;
	}

	/** Serializable snapshot of the unsaved state (for VS Code hot-exit backup). */
	public serialize(): { log: Change[]; nextChangeId: number } {
		return { log: this.log.map(change => structuredCloneChange(change)), nextChangeId: this.nextChangeId };
	}

	public restore(snapshot: { log: Change[]; nextChangeId: number }): void {
		this.log = snapshot.log.map(change => structuredCloneChange(change));
		this.redoStack = [];
		this.nextChangeId = snapshot.nextChangeId;
		this.rebuild();
	}

	public clear(): void {
		this.log = [];
		this.redoStack = [];
		this.rebuild();
	}

	// --- Mutations: append a new change (clears the redo stack), assigning it the next changeId. ---

	public setCellContent(rowIndex: number, columnIndex: number, value: string): Change {
		return this.append({ changeId: this.nextChangeId, type: 'set-cell-content', data: { rowIndex, columnIndex, value } });
	}

	public setHeaderContent(columnIndex: number, value: string): Change {
		return this.append({ changeId: this.nextChangeId, type: 'set-header-content', data: { columnIndex, value } });
	}

	public insertHeader(cells: string[]): Change {
		return this.append({ changeId: this.nextChangeId, type: 'insert-header', data: { cells: cells.slice() } });
	}

	public removeHeader(): Change {
		return this.append({ changeId: this.nextChangeId, type: 'remove-header' });
	}

	public insertRow(rowIndex: number): Change {
		return this.append({ changeId: this.nextChangeId, type: 'insert-row', data: { rowIndex } });
	}

	public deleteRowRange(offset: number, count: number): Change {
		return this.append({ changeId: this.nextChangeId, type: 'delete-row-range', data: { offset, count } });
	}

	private append(change: Change): Change {
		this.redoStack = [];
		this.log.push(change);
		this.nextChangeId = Math.max(this.nextChangeId, change.changeId) + 1;
		this.apply(change);
		return change;
	}

	/** Undo the most recent change; returns it (and the range it invalidated) or null if none. */
	public undo(): { change: Change; invalidatedRange: InvalidatedRange } | null {
		const change = this.log.pop();
		if (change === undefined) {
			return null;
		}

		this.redoStack.push(change);
		this.rebuild();
		return { change, invalidatedRange: invalidatedRangeFor(change) };
	}

	/** Redo the most recently undone change; returns it or null if none. */
	public redo(): { change: Change; invalidatedRange: InvalidatedRange } | null {
		const change = this.redoStack.pop();
		if (change === undefined) {
			return null;
		}

		this.log.push(change);
		this.apply(change);
		return { change, invalidatedRange: invalidatedRangeFor(change) };
	}

	/**
	 * Serve a virtual row range. `readBase` supplies (and splits) the original file rows; this
	 * method materializes inserted rows and overlays cell edits, returning the final virtual rows.
	 * Fast path: with no changes it is a single passthrough read.
	 */
	public readRows(virtualOffset: number, count: number, readBase: BaseRowReader): string[][] {
		if (count <= 0) {
			return [];
		}

		if (!this.hasChanges()) {
			return readBase(virtualOffset, count);
		}

		const rows: string[][] = [];
		let virtual = virtualOffset;
		for (const segment of this.resolveSegments(virtualOffset, count)) {
			if (segment.kind === 'base') {
				const baseRows = readBase(segment.baseStart, segment.length);
				for (let i = 0; i < baseRows.length; i++) {
					rows.push(this.decorate(baseIdentity(segment.baseStart + i), baseRows[i]));
					virtual++;
				}
			} else {
				for (const id of segment.ids) {
					rows.push(this.decorate(insertedIdentity(id), this.insertedRows.get(id) ?? []));
					virtual++;
				}
			}
		}
		return rows;
	}

	/**
	 * Resolve a virtual range into ordered base/inserted spans. Consecutive base rows are grouped
	 * into a single span so callers can read them contiguously.
	 */
	public resolveSegments(virtualOffset: number, count: number): ResolvedSegment[] {
		const resolved: ResolvedSegment[] = [];
		const end = virtualOffset + count;
		for (let virtual = virtualOffset; virtual < end;) {
			const segment = this.segmentAt(virtual);
			const offsetInSegment = virtual - segment.virtualStart;
			const available = segment.length === BASE_TAIL ? end - virtual : Math.min(end, segment.virtualStart + segment.length) - virtual;

			if (segment.kind === 'base') {
				resolved.push({ kind: 'base', baseStart: segment.baseStart + offsetInSegment, length: available });
			} else {
				resolved.push({ kind: 'inserted', ids: segment.ids.slice(offsetInSegment, offsetInSegment + available) });
			}
			virtual += available;
		}
		return resolved;
	}

	/** Whether a base (file-backed) row carries any cell edit — used by save to choose raw copy vs re-serialize. */
	public hasBaseRowEdit(baseRow: number): boolean {
		return this.cellEdits.has(baseIdentity(baseRow));
	}

	/** Apply any cell edits to a base row's cells (returns the same array if untouched). */
	public decorateBaseRow(baseRow: number, cells: string[]): string[] {
		return this.decorate(baseIdentity(baseRow), cells);
	}

	/** Final cells for an inserted row (empty base, plus any edits). */
	public decorateInsertedRow(id: number): string[] {
		return this.decorate(insertedIdentity(id), this.insertedRows.get(id) ?? []);
	}

	public hasHeaderEdits(): boolean {
		return this.headerEdits.size > 0;
	}

	/** Whether a header row was added to a header-less file (independent of the file's own first row). */
	public hasInsertedHeader(): boolean {
		return this.insertedHeader !== null;
	}

	/** The inserted header's base cells with header edits overlaid (empties preserved), or null if none. */
	public getInsertedHeaderCells(): string[] | null {
		return this.insertedHeader === null ? null : this.decorateHeader(this.insertedHeader);
	}

	/** Apply any header-cell edits to the base header cells (returns the same array if untouched). */
	public decorateHeader(cells: string[]): string[] {
		if (this.headerEdits.size === 0) {
			return cells;
		}

		const result = cells.slice();
		for (const [columnIndex, value] of this.headerEdits) {
			while (result.length <= columnIndex) {
				result.push('');
			}
			result[columnIndex] = value;
		}
		return result;
	}

	// --- Overlay construction ---

	private rebuild(): void {
		this.segments = [{ kind: 'base', virtualStart: 0, length: BASE_TAIL, baseStart: 0 }];
		this.cellEdits = new Map();
		this.headerEdits = new Map();
		this.insertedHeader = null;
		this.insertedRows = new Map();
		this.nextInsertedId = 1;
		this.rowCountDelta = 0;
		for (const change of this.log) {
			this.apply(change);
		}
	}

	private apply(change: Change): void {
		switch (change.type) {
			case 'set-cell-content':
				this.applySetCell(change.data.rowIndex, change.data.columnIndex, change.data.value);
				return;
			case 'set-header-content':
				this.headerEdits.set(change.data.columnIndex, change.data.value);
				return;
			case 'insert-header':
				this.insertedHeader = change.data.cells.slice();
				return;
			case 'remove-header':
				this.insertedHeader = null;
				return;
			case 'insert-row':
				this.applyInsertRow(change.data.rowIndex);
				return;
			case 'delete-row-range':
				this.applyDeleteRange(change.data.offset, change.data.count);
				return;
		}
	}

	private applySetCell(rowIndex: number, columnIndex: number, value: string): void {
		// Normalize on append: resolve the virtual row to its stable identity *now*, so the edit
		// survives later row shifts.
		const identity = this.identityAt(rowIndex);
		const rowEdits = this.cellEdits.get(identity) ?? new Map<number, string>();
		rowEdits.set(columnIndex, value);
		this.cellEdits.set(identity, rowEdits);
	}

	private applyInsertRow(rowIndex: number): void {
		const id = this.nextInsertedId++;
		this.insertedRows.set(id, []);
		this.splitAt(rowIndex);
		const index = this.segmentIndexAt(rowIndex);
		this.segments.splice(index, 0, { kind: 'inserted', virtualStart: rowIndex, length: 1, ids: [id] });
		this.shiftFrom(index + 1, 1);
		this.normalize();
		this.rowCountDelta += 1;
	}

	private applyDeleteRange(offset: number, count: number): void {
		if (count <= 0) {
			return;
		}

		this.splitAt(offset);
		this.splitAt(offset + count);
		const firstIndex = this.segmentIndexAt(offset);
		let removeCount = 0;
		for (let i = firstIndex; i < this.segments.length; i++) {
			const segment = this.segments[i];
			if (segment.virtualStart >= offset + count) {
				break;
			}
			removeCount++;
		}
		this.segments.splice(firstIndex, removeCount);
		this.shiftFrom(firstIndex, -count);
		this.normalize();
		this.rowCountDelta -= count;
	}

	/** Map a virtual row to the stable identity of the row currently occupying it. */
	private identityAt(virtualIndex: number): RowIdentity {
		const segment = this.segmentAt(virtualIndex);
		const offsetInSegment = virtualIndex - segment.virtualStart;
		if (segment.kind === 'base') {
			return baseIdentity(segment.baseStart + offsetInSegment);
		}
		return insertedIdentity(segment.ids[offsetInSegment]);
	}

	private decorate(identity: RowIdentity, cells: string[]): string[] {
		const rowEdits = this.cellEdits.get(identity);
		if (rowEdits === undefined) {
			return cells;
		}

		// Setting a cell beyond the current row length extends the row with empty cells.
		const result = cells.slice();
		for (const [columnIndex, value] of rowEdits) {
			while (result.length <= columnIndex) {
				result.push('');
			}
			result[columnIndex] = value;
		}
		return result;
	}

	// --- Segment list helpers ---

	private segmentAt(virtualIndex: number): Segment {
		return this.segments[this.segmentIndexAt(virtualIndex)];
	}

	private segmentIndexAt(virtualIndex: number): number {
		// Binary search for the segment whose range contains virtualIndex. The trailing base
		// segment is open-ended, so the last segment always matches a large index.
		let low = 0;
		let high = this.segments.length - 1;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if (this.segments[mid].virtualStart <= virtualIndex) {
				low = mid;
			} else {
				high = mid - 1;
			}
		}
		return low;
	}

	/** Ensure a segment boundary exists exactly at `virtualIndex` (no-op if already aligned). */
	private splitAt(virtualIndex: number): void {
		if (virtualIndex <= 0) {
			return;
		}

		const index = this.segmentIndexAt(virtualIndex);
		const segment = this.segments[index];
		if (segment.virtualStart === virtualIndex) {
			return;
		}

		const offsetInSegment = virtualIndex - segment.virtualStart;
		if (segment.kind === 'base') {
			const tail: BaseSegment = {
				kind: 'base',
				virtualStart: virtualIndex,
				length: segment.length === BASE_TAIL ? BASE_TAIL : segment.length - offsetInSegment,
				baseStart: segment.baseStart + offsetInSegment
			};
			segment.length = offsetInSegment;
			this.segments.splice(index + 1, 0, tail);
		} else {
			const tail: InsertedSegment = {
				kind: 'inserted',
				virtualStart: virtualIndex,
				length: segment.length - offsetInSegment,
				ids: segment.ids.slice(offsetInSegment)
			};
			segment.length = offsetInSegment;
			segment.ids = segment.ids.slice(0, offsetInSegment);
			this.segments.splice(index + 1, 0, tail);
		}
	}

	private shiftFrom(index: number, delta: number): void {
		for (let i = index; i < this.segments.length; i++) {
			this.segments[i].virtualStart += delta;
		}
	}

	/** Merge adjacent base segments that are contiguous in base space, keeping the list small. */
	private normalize(): void {
		for (let i = this.segments.length - 1; i > 0; i--) {
			const previous = this.segments[i - 1];
			const current = this.segments[i];
			if (previous.kind === 'base' && current.kind === 'base'
				&& previous.length !== BASE_TAIL
				&& previous.baseStart + previous.length === current.baseStart) {
				previous.length = current.length === BASE_TAIL ? BASE_TAIL : previous.length + current.length;
				this.segments.splice(i, 1);
			} else if (previous.kind === 'inserted' && current.kind === 'inserted') {
				previous.ids = previous.ids.concat(current.ids);
				previous.length += current.length;
				this.segments.splice(i, 1);
			}
		}
	}
}

type RowIdentity = string;

function baseIdentity(baseRow: number): RowIdentity {
	return `b${baseRow}`;
}

function insertedIdentity(id: number): RowIdentity {
	return `i${id}`;
}

function invalidatedRangeFor(change: Change): InvalidatedRange {
	switch (change.type) {
		case 'set-cell-content':
			return { startRowIndex: change.data.rowIndex, endRowIndex: change.data.rowIndex };
		case 'set-header-content':
		case 'insert-header':
		case 'remove-header':
			// Header changes touch no data rows; an empty range (end < start) signals "header only".
			return { startRowIndex: 0, endRowIndex: -1 };
		case 'insert-row':
			return { startRowIndex: change.data.rowIndex, endRowIndex: null };
		case 'delete-row-range':
			return { startRowIndex: change.data.offset, endRowIndex: null };
	}
}

function structuredCloneChange(change: Change): Change {
	if (change.type === 'remove-header') {
		return { changeId: change.changeId, type: 'remove-header' };
	}
	if (change.type === 'insert-header') {
		return { changeId: change.changeId, type: 'insert-header', data: { cells: change.data.cells.slice() } };
	}
	return { ...change, data: { ...change.data } } as Change;
}
