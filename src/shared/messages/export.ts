// --- Export system (see local/features/exports/architecture.md) ---

/** The closed set of known exporter ids. Capability descriptors (below) are the runtime source of
 * truth for what UI the webview renders; only formats actually present in `exportCapabilities` are
 * offered. */
export type ExportFormat =
	| 'json' | 'markdown' | 'latex' | 'typst' | 'html'
	| 'xlsx' | 'sql' | 'mongodb';

export type ExportDestination = 'file' | 'clipboard';
export type ExportRowScope = 'all' | 'filtered';
export type ColumnAlignment = 'left' | 'center' | 'right';

/** Semantic kind of an exporter type, used by the shared field formatter to coerce a raw cell. */
export type ExportTypeKind = 'text' | 'numeric' | 'date' | 'boolean';

export interface ExportColumnStyle {
	columnIndex: number;
	align: ColumnAlignment;          // 'left' when unset
	foregroundColor: string | null;  // hex like '#rrggbb' or null
	backgroundColor: string | null;
}

export interface ExportFilterDefinition {
	query: string;
	matchCase: boolean;
	wholeWord: boolean;
	regex: boolean;
	selectedColumns: number[];       // find's column restriction
}

/** A user-assigned column type, carried inside `formatOptions.columnTypes`. */
export interface ExportColumnType {
	columnIndex: number;             // source column index
	typeId: string;                  // an id from the active exporter's type system
}

export interface ExportRequestMessage {
	type: 'exportRequest';
	requestId: string;
	format: ExportFormat;
	destination: ExportDestination;
	columns: number[];               // selected column indices, in export order (ascending)
	scope: ExportRowScope;
	filter?: ExportFilterDefinition; // required when scope === 'filtered'
	retainAlignment: boolean;
	retainColors: boolean;
	columnStyles: ExportColumnStyle[]; // only for the selected columns; empty if not retaining
	/** Opaque, validated per format. May carry `columnTypes: ExportColumnType[]`. */
	formatOptions: Record<string, unknown>;
}

export interface ExportProgressMessage {
	type: 'exportProgress';
	requestId: string;
	rowsProcessed: number;
	totalRows: number | null;        // null while still being counted
}

export interface ExportCompleteMessage {
	type: 'exportComplete';
	requestId: string;
	destination: ExportDestination;
	rowCount: number;
	byteCount: number;
	filePath?: string;               // present for file destination
}

export interface ExportErrorMessage {
	type: 'exportError';
	requestId: string;
	message: string;
}

/** One selectable type in an exporter's own type system. */
export interface ExportTypeDescriptor {
	id: string;                      // exporter-specific id, e.g. 'number', 'date'
	label: string;                   // shown in the per-column type picker
	kind: ExportTypeKind;            // how the shared formatter coerces values of this type
}

export interface ExporterFeatures {
	typing: boolean;                 // supports per-column typing (has a type system)
	alignment: boolean;
	colors: boolean;
	parameters: boolean;
	clipboard: boolean;              // supports clipboard destination
}

/** A self-description each exporter publishes; collected into `exportCapabilities` at init. */
export interface ExporterDescriptor {
	id: ExportFormat;
	description: string;
	fileExtension: string;           // default save-dialog extension (without dot), e.g. 'json'
	features: ExporterFeatures;
	types: ExportTypeDescriptor[];   // the exporter's type system (empty when !features.typing)
}

/** A detected per-column default type (from detectColumnDataTypes) used to seed the type pickers. */
export interface ExportDefaultColumnType {
	columnIndex: number;
	baseType: 'text' | 'integer' | 'decimal';
	locale?: string;
}

export interface ExportCapabilitiesMessage {
	type: 'exportCapabilities';
	exporters: ExporterDescriptor[];            // the registry, sent once at init
	defaultColumnTypes: ExportDefaultColumnType[]; // detected defaults to seed the pickers
}
