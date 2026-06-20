import type { CsvDocumentChanges } from './CsvDocumentChanges';
import { splitCells } from './csv/splitCells';
import type { CsvMappingReader } from './io/CsvMappingReader';

/**
 * Read-only view that maps the *displayed* (header-excluded, edit-applied) row space onto the
 * physical file rows served by the reader. Owns the header-offset and inserted/deleted-row math
 * that the find subsystem, paging and saving all consume, so the translation lives in exactly one
 * place. Panel-agnostic and free of any webview/transport concerns.
 *
 * `hasHeader` is read through a getter because the header flag is mutable: applyConfigChange can
 * toggle it after a re-index.
 */
export class CsvRowView {
	public constructor(
		private readonly reader: CsvMappingReader,
		private readonly changes: CsvDocumentChanges,
		private readonly hasHeader: () => boolean,
	) { }

	/** Translate a displayed (data) row index to its physical file row, accounting for the header. */
	public displayedToPhysical(displayedRow: number): number {
		return displayedRow + (this.hasHeader() ? 1 : 0);
	}

	/** Base (original-file) readable data rows, excluding the header. */
	public getBaseReadableRowCount(): number {
		return Math.max(0, this.reader.getReadableRowCount() - (this.hasHeader() ? 1 : 0));
	}

	/** Virtual readable data rows = base readable rows adjusted by pending inserts/deletes. */
	public getDisplayedReadableRowCount(): number {
		return Math.max(0, this.getBaseReadableRowCount() + this.changes.getRowCountDelta());
	}

	/** Displayed data-row count derived from a raw (header-inclusive) row count, e.g. from streaming stats. */
	public displayedRowCountFor(rawRowCount: number): number {
		const base = Math.max(0, rawRowCount - (this.hasHeader() ? 1 : 0));
		return Math.max(0, base + this.changes.getRowCountDelta());
	}

	/**
	 * Read a range of *virtual* (displayed, change-applied) rows as cells. Goes through
	 * CsvDocumentChanges so inserts/deletes/cell edits are reflected; returns `[]` until the CSV
	 * configuration is available. The find feature and paging both consume this single view.
	 */
	public readVirtualRows(offset: number, rowCount: number): string[][] {
		const config = this.reader.getConfig();
		if (config === null) {
			return [];
		}

		return this.changes.readRows(offset, rowCount, (baseStart, length) =>
			this.readRange(baseStart, length).map(row => splitCells(row, config.separator)));
	}

	/** `readVirtualRows` guarded by `canReadDisplayedRange`; `[]` when that range is not currently readable. */
	public readDisplayedRows(offset: number, rowCount: number): string[][] {
		if (rowCount <= 0 || !this.canReadDisplayedRange(offset, rowCount)) {
			return [];
		}

		if (this.reader.getConfig() === null) {
			throw new Error('Cannot read rows before CSV configuration is available');
		}

		return this.readVirtualRows(offset, rowCount);
	}

	public canReadDisplayedRange(offset: number, rowCount: number): boolean {
		if (offset < 0 || rowCount < 0 || !Number.isInteger(offset) || !Number.isInteger(rowCount)) {
			return false;
		}

		if (rowCount === 0) {
			return true;
		}

		if (!this.changes.hasChanges()) {
			// No edits (always true while the file is still streaming): defer to the reader, which
			// allows a partial read at the end of a final file and requires the full range while
			// streaming. This is what keeps small files (rowCount < requested block) loadable.
			return this.reader.canReadRange(this.displayedToPhysical(offset), rowCount);
		}

		// Edits only exist once the file is final. Reject starts past the virtual row count; otherwise
		// each base span the (clamped) range resolves to must be within the reader's readable range.
		// Inserted rows are always readable.
		const virtualReadable = this.getDisplayedReadableRowCount();
		if (offset >= virtualReadable) {
			return false;
		}

		const availableCount = Math.min(rowCount, virtualReadable - offset);
		for (const segment of this.changes.resolveSegments(offset, availableCount)) {
			if (segment.kind === 'base' && !this.reader.canReadRange(this.displayedToPhysical(segment.baseStart), segment.length)) {
				return false;
			}
		}
		return true;
	}

	private readRange(rowOffset: number, rowCount: number): string[] {
		return this.reader.readRange(this.displayedToPhysical(rowOffset), rowCount);
	}
}
