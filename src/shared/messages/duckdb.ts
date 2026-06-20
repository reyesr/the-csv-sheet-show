// --- DuckDB tool: open a terminal with the current CSV mounted ---

/**
 * How the CSV should be mounted into the DuckDB session:
 * - `table`: a materialized in-memory snapshot (`CREATE TABLE`), fast for repeated queries.
 * - `view`: a `CREATE VIEW` that re-reads the file on each query, reflecting later file changes.
 */
export type DuckDbTableKind = 'table' | 'view';

/**
 * The decimal separator DuckDB should use when parsing numeric columns. The webview seeds this from
 * the file's detected config but lets the user override it before launching the session.
 */
export type DuckDbDecimalSeparator = '.' | ',';

/** Where the DuckDB executable path came from. */
export type DuckDbCommandOrigin = 'default-path' | 'settings';

/** Webview → extension. Asks whether the configured/default DuckDB command is available. */
export interface CheckDuckDbRequestMessage {
	type: 'checkDuckDb';
}

/** The resolved DuckDB command and whether it can be launched successfully. */
export interface DuckDbStatus {
	path: string;
	exists: boolean;
	isExecutable: boolean;
	origin: DuckDbCommandOrigin;
}

/** Extension → webview. Response to {@link CheckDuckDbRequestMessage}. */
export interface DuckDbStatusMessage extends DuckDbStatus {
	type: 'duckDbStatus';
}

/**
 * Webview → extension. Asks the extension to launch an integrated terminal running the `duckdb`
 * REPL with the current file pre-loaded under `tableName` (default `data`). Fire-and-forget: the
 * only failure (DuckDB not installed) is surfaced as a VS Code notification, not a reply.
 */
export interface RunDuckDbRequestMessage {
	type: 'runDuckDb';
	requestId: string;
	tableKind: DuckDbTableKind;
	tableName: string;
	/** Passed to DuckDB's `read_csv(decimal_separator=…)`; seeded from the file's detected config. */
	decimalSeparator: DuckDbDecimalSeparator;
}
