import { Accessor, createEffect, createMemo, createSignal } from 'solid-js';
import type {
	ExportCapabilitiesMessage,
	ExportColumnStyle,
	ExportColumnType,
	ExportCompleteMessage,
	ExportDestination,
	ExporterDescriptor,
	ExportErrorMessage,
	ExportFormat,
	ExportProgressMessage,
	ExportRowScope
} from '../../../../src/shared/messages/export';
import type { CsvGridController, FindController } from '../../types';
import type { ColumnDisplayOptions } from '../virtual-table/types';
import { postMessage } from '../../vscode';

export type ExportStatus = 'idle' | 'running' | 'done' | 'error';

/** JSON-specific format options surfaced in the panel. */
export interface JsonExportOptions {
	shape: 'objects' | 'arrays' | 'ndjson';
	indent: 0 | 2 | 4 | '\t';
	emptyAs: 'null' | 'empty-string' | 'omit';
	keyStyle: 'header' | 'as-is' | 'camelCase' | 'snake_case';
	includeHeaderRow: boolean;
}

/** HTML-specific format options surfaced in the panel. */
export interface HtmlExportOptions {
	wrap: 'fragment' | 'styled-fragment' | 'document';
	styleMode: 'inline' | 'classes';
	includeHeaderRow: boolean;
	tableClass: string;
	bordered: boolean;
	newline: 'pre-wrap' | 'br';
}

export interface ExportController {
	/** Cached exporter descriptors received once at init. */
	exporters: Accessor<ExporterDescriptor[]>;
	activeDescriptor: Accessor<ExporterDescriptor | undefined>;
	format: Accessor<ExportFormat>;
	setFormat: (format: ExportFormat) => void;

	selectedColumns: Accessor<number[]>;
	toggleColumn: (columnIndex: number) => void;
	selectAllColumns: () => void;
	clearColumns: () => void;

	scope: Accessor<ExportRowScope>;
	setScope: (scope: ExportRowScope) => void;
	filterActive: Accessor<boolean>;

	typingEnabled: Accessor<boolean>;
	setTypingEnabled: (enabled: boolean) => void;
	/** Type id assigned to a column (the user's choice, else the detected default). */
	effectiveTypeId: (columnIndex: number) => string;
	setColumnType: (columnIndex: number, typeId: string) => void;
	/** Columns that will be exported, in order (resolves "all" when none selected). */
	resolvedColumns: Accessor<number[]>;

	json: Accessor<JsonExportOptions>;
	setJson: (patch: Partial<JsonExportOptions>) => void;

	html: Accessor<HtmlExportOptions>;
	setHtml: (patch: Partial<HtmlExportOptions>) => void;

	/** Whether to retain the grid's per-column alignment / colors (only when the exporter supports it). */
	retainAlignment: Accessor<boolean>;
	setRetainAlignment: (retain: boolean) => void;
	retainColors: Accessor<boolean>;
	setRetainColors: (retain: boolean) => void;

	status: Accessor<ExportStatus>;
	statusMessage: Accessor<string>;
	rowsProcessed: Accessor<number>;
	totalRows: Accessor<number | null>;
	busy: Accessor<boolean>;

	exportToFile: () => void;
	exportToClipboard: () => void;

	handleCapabilities: (message: ExportCapabilitiesMessage) => void;
	handleProgress: (message: ExportProgressMessage) => void;
	handleComplete: (message: ExportCompleteMessage) => void;
	handleError: (message: ExportErrorMessage) => void;
}

const DEFAULT_JSON_OPTIONS: JsonExportOptions = {
	shape: 'objects',
	indent: 2,
	emptyAs: 'null',
	keyStyle: 'header',
	includeHeaderRow: false
};

const DEFAULT_HTML_OPTIONS: HtmlExportOptions = {
	wrap: 'styled-fragment',
	styleMode: 'classes',
	includeHeaderRow: true,
	tableClass: 'csv-export',
	bordered: true,
	newline: 'pre-wrap'
};

/**
 * Holds the export panel's UI state and assembles the {@link ExportRequestMessage}. The reverse
 * channel (capabilities, progress, result) is fed in by the message bridge. See architecture.md §4.
 */
export function createExportController(input: {
	grid: CsvGridController;
	find: FindController;
	/** Per-column display options (alignment + colors), read when retaining styling in an export. */
	getColumnDisplayOptions: (columnIndex: number) => ColumnDisplayOptions;
}): ExportController {
	const [exporters, setExporters] = createSignal<ExporterDescriptor[]>([]);
	const [defaultColumnTypes, setDefaultColumnTypes] = createSignal<ExportCapabilitiesMessage['defaultColumnTypes']>([]);
	const [format, setFormatSignal] = createSignal<ExportFormat>('json');
	const [selectedColumns, setSelectedColumns] = createSignal<number[]>([]);
	const [scope, setScope] = createSignal<ExportRowScope>('all');
	const [typingEnabled, setTypingEnabled] = createSignal(false);
	const [columnTypes, setColumnTypes] = createSignal<Record<number, string>>({});
	const [json, setJsonSignal] = createSignal<JsonExportOptions>(DEFAULT_JSON_OPTIONS);
	const [html, setHtmlSignal] = createSignal<HtmlExportOptions>(DEFAULT_HTML_OPTIONS);
	const [retainAlignment, setRetainAlignment] = createSignal(true);
	const [retainColors, setRetainColors] = createSignal(true);

	const [status, setStatus] = createSignal<ExportStatus>('idle');
	const [statusMessage, setStatusMessage] = createSignal('');
	const [rowsProcessed, setRowsProcessed] = createSignal(0);
	const [totalRows, setTotalRows] = createSignal<number | null>(null);
	let inFlightRequestId: string | null = null;
	let requestCounter = 0;

	const activeDescriptor = createMemo(() => exporters().find(descriptor => descriptor.id === format()));
	const filterActive = createMemo(() => input.find.filterMode() && input.find.findQuery().length > 0);
	const busy = (): boolean => status() === 'running';

	// Default the row scope to the filter's state, while still letting the user override mid-session.
	createEffect(() => setScope(filterActive() ? 'filtered' : 'all'));

	const resolvedColumns = createMemo(() => {
		const selected = selectedColumns();
		if (selected.length > 0) {
			return [...selected].sort((a, b) => a - b);
		}
		return Array.from({ length: input.grid.maxColumnCount() }, (_, index) => index);
	});

	function defaultTypeId(columnIndex: number): string {
		const descriptor = activeDescriptor();
		if (descriptor === undefined) {
			return 'text';
		}
		const base = defaultColumnTypes().find(entry => entry.columnIndex === columnIndex)?.baseType ?? 'text';
		const wantedKind = base === 'integer' || base === 'decimal' ? 'numeric' : 'text';
		return descriptor.types.find(type => type.kind === wantedKind)?.id
			?? descriptor.types.find(type => type.kind === 'text')?.id
			?? descriptor.types[0]?.id
			?? 'text';
	}

	function effectiveTypeId(columnIndex: number): string {
		return columnTypes()[columnIndex] ?? defaultTypeId(columnIndex);
	}

	function buildFormatOptions(): Record<string, unknown> {
		const options: Record<string, unknown> = {};
		if (format() === 'json') {
			const current = json();
			options.shape = current.shape;
			options.indent = current.indent;
			options.emptyAs = current.emptyAs;
			options.keyStyle = current.keyStyle;
			options.includeHeaderRow = current.includeHeaderRow;
		}
		if (format() === 'html') {
			const current = html();
			options.wrap = current.wrap;
			options.styleMode = current.styleMode;
			options.includeHeaderRow = current.includeHeaderRow;
			options.tableClass = current.tableClass;
			options.bordered = current.bordered;
			options.newline = current.newline;
		}
		if (typingEnabled() && activeDescriptor()?.features.typing === true) {
			options.columnTypes = resolvedColumns().map((columnIndex): ExportColumnType => ({
				columnIndex,
				typeId: effectiveTypeId(columnIndex)
			}));
		}
		return options;
	}

	/** Resolve the styling to retain, gated by what the active exporter actually supports. */
	function buildColumnStyles(): { retainAlignment: boolean; retainColors: boolean; columnStyles: ExportColumnStyle[] } {
		const descriptor = activeDescriptor();
		const retAlign = descriptor?.features.alignment === true && retainAlignment();
		const retColors = descriptor?.features.colors === true && retainColors();
		if (!retAlign && !retColors) {
			return { retainAlignment: false, retainColors: false, columnStyles: [] };
		}

		const columnStyles = resolvedColumns().map((columnIndex): ExportColumnStyle => {
			const display = input.getColumnDisplayOptions(columnIndex);
			return {
				columnIndex,
				align: retAlign ? display.textAlign : 'left',
				foregroundColor: retColors ? display.foregroundColor : null,
				backgroundColor: retColors ? display.backgroundColor : null
			};
		});
		return { retainAlignment: retAlign, retainColors: retColors, columnStyles };
	}

	function startExport(destination: ExportDestination): void {
		if (busy() || !input.grid.isFinal()) {
			return;
		}

		const effectiveScope: ExportRowScope = scope() === 'filtered' && filterActive() ? 'filtered' : 'all';
		const requestId = `export-${Date.now()}-${requestCounter++}`;
		inFlightRequestId = requestId;
		setStatus('running');
		setRowsProcessed(0);
		setTotalRows(null);
		setStatusMessage('Exporting…');

		const styling = buildColumnStyles();
		postMessage({
			type: 'exportRequest',
			requestId,
			format: format(),
			destination,
			columns: resolvedColumns(),
			scope: effectiveScope,
			filter: effectiveScope === 'filtered'
				? {
					query: input.find.findQuery(),
					matchCase: input.find.findMatchCase(),
					wholeWord: input.find.findWholeWord(),
					regex: input.find.findRegex(),
					selectedColumns: input.find.selectedFindColumns()
				}
				: undefined,
			retainAlignment: styling.retainAlignment,
			retainColors: styling.retainColors,
			columnStyles: styling.columnStyles,
			formatOptions: buildFormatOptions()
		});
	}

	return {
		exporters,
		activeDescriptor,
		format,
		setFormat: format => setFormatSignal(format),
		selectedColumns,
		toggleColumn: columnIndex => setSelectedColumns(current =>
			current.includes(columnIndex) ? current.filter(index => index !== columnIndex) : [...current, columnIndex]),
		selectAllColumns: () => setSelectedColumns(Array.from({ length: input.grid.maxColumnCount() }, (_, index) => index)),
		clearColumns: () => setSelectedColumns([]),
		scope,
		setScope,
		filterActive,
		typingEnabled,
		setTypingEnabled,
		effectiveTypeId,
		setColumnType: (columnIndex, typeId) => setColumnTypes(current => ({ ...current, [columnIndex]: typeId })),
		resolvedColumns,
		json,
		setJson: patch => setJsonSignal(current => ({ ...current, ...patch })),
		html,
		setHtml: patch => setHtmlSignal(current => ({ ...current, ...patch })),
		retainAlignment,
		setRetainAlignment,
		retainColors,
		setRetainColors,
		status,
		statusMessage,
		rowsProcessed,
		totalRows,
		busy,
		exportToFile: () => startExport('file'),
		exportToClipboard: () => startExport('clipboard'),
		handleCapabilities: message => {
			setExporters(message.exporters);
			setDefaultColumnTypes(message.defaultColumnTypes);
			if (message.exporters.find(descriptor => descriptor.id === format()) === undefined && message.exporters.length > 0) {
				setFormatSignal(message.exporters[0].id);
			}
		},
		handleProgress: message => {
			if (message.requestId !== inFlightRequestId) {
				return;
			}
			setRowsProcessed(message.rowsProcessed);
			setTotalRows(message.totalRows);
		},
		handleComplete: message => {
			if (message.requestId !== inFlightRequestId) {
				return;
			}
			inFlightRequestId = null;
			setStatus('done');
			const rows = message.rowCount.toLocaleString();
			const size = formatBytes(message.byteCount);
			setStatusMessage(message.destination === 'clipboard'
				? `Copied ${rows} rows (${size}) to the clipboard.`
				: `Exported ${rows} rows (${size}) to ${message.filePath ?? 'file'}.`);
		},
		handleError: message => {
			if (message.requestId !== inFlightRequestId) {
				return;
			}
			inFlightRequestId = null;
			setStatus('error');
			setStatusMessage(message.message);
		}
	};
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
