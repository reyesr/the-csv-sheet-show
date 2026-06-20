import type { CsvFileConfig } from '../csv/CsvFileConfig';
import type { CsvSearchReader } from '../io/CsvSearchReader';
import type { ExportFilterDefinition } from '../shared/messages/export';

/**
 * The slice of the document the export service reads through (a Dependency-Inversion port), so the
 * service stays decoupled from `CsvDocument`'s editing/paging/saving concerns. Lives apart from
 * `types.ts` because `CsvSearchReader` pulls in Node-only modules that must not reach the webview.
 */
export interface ExportDocumentHost {
	/** Read displayed (header-excluded, edit-applied) rows as cell arrays. */
	readVirtualRows(offset: number, count: number): string[][];
	getDisplayedReadableRowCount(): number;
	/** Effective header cells (edits applied; empties preserved), or null when the file has no header. */
	getEffectiveHeaderCells(): string[] | null;
	getConfig(): CsvFileConfig | null;
	isIndexingFinal(): boolean;
	/** Build a fresh, self-contained filter scan for `filter` over the final file. */
	createFilterScanReader(filter: ExportFilterDefinition): CsvSearchReader;
	/**
	 * Run `read` inside the document's operation queue so a save or config-change re-index cannot
	 * mutate the reader/overlay while the export is reading rows. Keep the user-facing save dialog
	 * outside this so it doesn't hold the queue while waiting on the user.
	 */
	runExclusive<T>(read: () => Promise<T>): Promise<T>;
}
