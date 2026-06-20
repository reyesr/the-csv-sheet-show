import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { CsvFileConfig } from '../csv/CsvFileConfig';
import type { DuckDbDecimalSeparator, DuckDbStatus, RunDuckDbRequestMessage } from '../shared/messages/duckdb';

/** The read-only port the DuckDB tool drives: the parse config to mirror, and a save to flush edits. */
export interface DuckDbDocumentHost {
	/** The current detected/overridden CSV config, or `null` while it is still being detected. */
	getConfig(): CsvFileConfig | null;
	/** Persist pending in-grid edits to disk so DuckDB (which reads the file) sees them. No-op when clean. */
	save(): Promise<void>;
}

/** Where DuckDB will be launched from, and whether that came from the user's setting or the PATH default. */
interface DuckDbExecutable {
	command: string;
	configured: boolean;
	origin: DuckDbStatus['origin'];
}

interface ExecutableProbe {
	exists: boolean;
	isExecutable: boolean;
}

/**
 * Launches an integrated terminal whose process *is* the `duckdb` REPL, pre-loading the current CSV
 * under a table or view via a temporary `-init` script. Running DuckDB directly as the terminal
 * shell avoids any host-shell quoting of the file path. Fire-and-forget: the only failure surfaced
 * to the user is a missing executable, reported as a VS Code notification.
 */
export class DuckDbTerminalService {
	public constructor(
		private readonly host: DuckDbDocumentHost,
		private readonly uri: vscode.Uri,
		private readonly log: (message: string) => void = () => { }
	) { }

	public async run(request: RunDuckDbRequestMessage): Promise<void> {
		try {
			await this.runInternal(request);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log(`Run DuckDB failed: ${message}`);
			void vscode.window.showErrorMessage(`Could not open DuckDB: ${message}`);
		}
	}

	private async runInternal(request: RunDuckDbRequestMessage): Promise<void> {
		const executable = resolveDuckDbExecutable();
		const status = await probeDuckDbExecutable(executable);
		if (!status.isExecutable) {
			await this.reportUnavailableExecutable(status);
			return;
		}

		// Save first so the file on disk reflects any pending in-grid edits (a no-op when the document is clean).
		await this.host.save();

		const initPath = writeInitScript(this.buildInitScript(request));
		const terminal = vscode.window.createTerminal({
			name: `DuckDB: ${path.basename(this.uri.fsPath)}`,
			shellPath: executable.command,
			shellArgs: ['-init', initPath]
		});
		terminal.show();
		this.log(`Opened DuckDB terminal for ${this.uri.fsPath} (${request.tableKind} "${request.tableName}")`);

		// Best-effort cleanup: drop the temp init file once this terminal closes.
		const subscription = vscode.window.onDidCloseTerminal(closed => {
			if (closed === terminal) {
				subscription.dispose();
				try {
					fs.unlinkSync(initPath);
				} catch {
					// The temp file may already be gone — ignore.
				}
			}
		});
	}

	/** Build the `-init` SQL: create the table/view from the file, then print a one-line readiness banner. */
	private buildInitScript(request: RunDuckDbRequestMessage): string {
		const tableName = request.tableName.trim() === '' ? 'data' : request.tableName.trim();
		const keyword = request.tableKind === 'view' ? 'VIEW' : 'TABLE';
		const identifier = quoteIdentifier(tableName);
		const banner = `DuckDB ready — ${keyword.toLowerCase()} ${identifier} loaded. Try: SELECT * FROM ${identifier} LIMIT 10;`;
		return [
			'.mode duckbox',
			`CREATE ${keyword} ${identifier} AS SELECT * FROM ${this.buildReadCsvCall(request)};`,
			`SELECT ${quoteString(banner)} AS info;`,
			''
		].join('\n');
	}

	/** The `read_csv(...)` source expression, mirroring the grid's detected parse config when available. */
	private buildReadCsvCall(request: RunDuckDbRequestMessage): string {
		return buildReadCsvSource(this.uri.fsPath, this.host.getConfig(), request.decimalSeparator);
	}

	private async reportUnavailableExecutable(status: DuckDbStatus): Promise<void> {
		const detail = formatDuckDbUnavailableMessage(status);
		this.log(detail);
		const choice = await vscode.window.showErrorMessage(detail, 'Open Settings');
		if (choice === 'Open Settings') {
			void vscode.commands.executeCommand('workbench.action.openSettings', 'csv-sheet-show.duckdbPath');
		}
	}
}

/** Resolve the DuckDB command: the `duckdbPath` setting when set, otherwise `duckdb` on the PATH. */
function resolveDuckDbExecutable(): DuckDbExecutable {
	const configured = vscode.workspace.getConfiguration('csv-sheet-show').get<string>('duckdbPath')?.trim() ?? '';
	return configured.length > 0
		? { command: configured, configured: true, origin: 'settings' }
		: { command: 'duckdb', configured: false, origin: 'default-path' };
}

/** Probe the resolved DuckDB command for the webview status panel. */
export function checkDuckDbExecutable(): Promise<DuckDbStatus> {
	return probeDuckDbExecutable(resolveDuckDbExecutable());
}

/** Probe whether `duckdb --version` runs, so launch and UI status share the same availability check. */
async function probeDuckDbExecutable(executable: DuckDbExecutable): Promise<DuckDbStatus> {
	const existsHint = executable.configured ? await pathExists(executable.command) : false;
	const probe = await probeExecutable(executable.command, existsHint);
	return {
		path: executable.command,
		exists: probe.exists,
		isExecutable: probe.isExecutable,
		origin: executable.origin
	};
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.promises.access(filePath, fs.constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function probeExecutable(command: string, existsHint: boolean): Promise<ExecutableProbe> {
	return new Promise(resolve => {
		let settled = false;
		let started = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (probe: ExecutableProbe): void => {
			if (!settled) {
				settled = true;
				if (timer !== undefined) {
					clearTimeout(timer);
				}
				resolve(probe);
			}
		};
		try {
			const child = spawn(command, ['--version'], { stdio: 'ignore', windowsHide: true });
			child.on('spawn', () => { started = true; });
			child.on('error', error => {
				const code = (error as NodeJS.ErrnoException).code;
				finish({ exists: existsHint || code !== 'ENOENT', isExecutable: false });
			});
			child.on('close', code => finish({ exists: true, isExecutable: code === 0 }));
			timer = setTimeout(() => {
				try {
					child.kill();
				} catch {
					// ignore
				}
				finish({ exists: existsHint || started, isExecutable: false });
			}, 5000);
			timer.unref?.();
		} catch {
			finish({ exists: existsHint, isExecutable: false });
		}
	});
}

function formatDuckDbUnavailableMessage(status: DuckDbStatus): string {
	if (!status.exists) {
		return status.origin === 'settings'
			? `DuckDB was not found at "${status.path}" (the path set in "csv-sheet-show.duckdbPath").`
			: 'DuckDB was not found on your PATH. Install it from https://duckdb.org, or set "csv-sheet-show.duckdbPath" to its location.';
	}

	return status.origin === 'settings'
		? `DuckDB was found at "${status.path}" (the path set in "csv-sheet-show.duckdbPath"), but it could not be executed.`
		: 'DuckDB was found on your PATH, but it could not be executed.';
}

/** Write the init SQL to a uniquely-named temp file and return its path. */
function writeInitScript(contents: string): string {
	const fileName = `csv-sheet-show-duckdb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sql`;
	const filePath = path.join(os.tmpdir(), fileName);
	fs.writeFileSync(filePath, contents, 'utf8');
	return filePath;
}

/** Quote a value as a single-quoted SQL string literal (doubling embedded single quotes). */
function quoteString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/** Quote a value as a double-quoted SQL identifier (doubling embedded double quotes). */
function quoteIdentifier(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Build the `read_csv(...)` source expression mirroring the detected parse config, with the
 * user-chosen decimal separator. When the config has not been detected yet (`null`), falls back to
 * `read_csv_auto` so DuckDB sniffs the format itself. Exported for unit testing.
 */
export function buildReadCsvSource(
	fsPath: string,
	config: CsvFileConfig | null,
	decimalSeparator: DuckDbDecimalSeparator
): string {
	const filePath = quoteString(fsPath.replace(/\\/g, '/'));
	if (config === null) {
		// Config not detected yet — let DuckDB sniff the format itself.
		return `read_csv_auto(${filePath})`;
	}

	const options = [
		`delim=${quoteString(duckdbDelimiter(config.separator))}`,
		`header=${config.hasHeader ? 'true' : 'false'}`,
		// The user picks the decimal separator in the Tools panel (seeded from the detected config).
		`decimal_separator=${quoteString(decimalSeparator)}`
	];
	return `read_csv(${filePath}, ${options.join(', ')})`;
}

/** DuckDB's CSV reader accepts the two-character escape `\t` for a tab delimiter. */
function duckdbDelimiter(separator: string): string {
	return separator === '\t' ? '\\t' : separator;
}
