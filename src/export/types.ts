import type { ColumnAlignment, ExportTypeKind } from '../shared/messages/export';

/**
 * Encoder/runtime contracts for the export pipeline. Deliberately Node-free (no `fs`/`events`/
 * `CsvSearchReader`), so the webview dev emulator can import the encoders and run a real in-browser
 * export. The IO-bound pieces (`ExportService`, sinks, the {@link ExportDocumentHost} in
 * `exportHost.ts`) live in their own modules and are the only ones that touch Node APIs.
 *
 * See local/features/exports/architecture.md §3.5.
 */

/** A selected column resolved for export: its source index, display name, assigned type, and styling. */
export interface ExportColumn {
	/** 0-based source column index. */
	sourceIndex: number;
	/** Display name (header cell when present, otherwise a synthesized `column_N`). */
	name: string;
	/** Assigned exporter type id ('text' when typing is off / unassigned). */
	typeId: string;
	/** Semantic kind of the assigned type, driving value coercion in the field formatter. */
	kind: ExportTypeKind;
	/**
	 * Retained text alignment ('left' when alignment is not retained). Populated by the service from
	 * the request's `columnStyles`; only styling-aware encoders (HTML/LaTeX/Typst/XLSX) read it.
	 */
	align?: ColumnAlignment;
	/** Retained foreground color (hex like `#rrggbb`), or null when not retained / unset. */
	foregroundColor?: string | null;
	/** Retained background color (hex like `#rrggbb`), or null when not retained / unset. */
	backgroundColor?: string | null;
}

/** The result of applying a column's assigned type to one raw cell. */
export interface FormattedField {
	/** The original cell value. */
	raw: string;
	/** True for an empty/whitespace cell, regardless of the assigned type. */
	empty: boolean;
	/**
	 * The value coerced to the column's assigned kind (e.g. a decimal-normalized numeric string).
	 * `undefined` when the cell does not satisfy the assigned type — the encoder then falls back
	 * (e.g. emits it as a quoted string).
	 */
	coerced?: string;
}

/** Everything an encoder needs that is constant across the run. */
export interface ExportContext {
	/** Selected columns, in export order. */
	columns: ExportColumn[];
	/** Whether the document has a (real) header row; table formats use this to decide header emission. */
	hasHeader: boolean;
	/** Total data rows if known up front, else null. */
	rowCount: number | null;
	/** Validated/defaulted format-specific options. */
	formatOptions: Record<string, unknown>;
	/** Apply the assigned type of column `columnIndex` (position in `columns`) to a raw cell. */
	formatField: (raw: string, columnIndex: number) => FormattedField;
}

/** A streaming text encoder: preamble, one chunk per row, postamble. */
export interface TextExportEncoder {
	begin(ctx: ExportContext): string;
	/** `cells` are already projected to the selected columns, in export order. */
	encodeRow(cells: string[], rowIndex: number, ctx: ExportContext): string;
	end(ctx: ExportContext): string;
}

export interface ExportSinkResult {
	byteCount: number;
	filePath?: string;
}

/** Where encoded bytes go (file / clipboard). Decouples encoders from the destination. */
export interface ExportSink {
	write(chunk: string): void;
	/** Resolve once buffered output has been flushed (keeps the file path memory-bounded). */
	drain(): Promise<void>;
	finalize(): Promise<ExportSinkResult>;
	/** Best-effort cleanup of partial output on error/cancel. */
	dispose(): Promise<void>;
}
