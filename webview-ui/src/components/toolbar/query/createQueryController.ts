import { type Accessor, createSignal } from 'solid-js';
import type { DuckDbDecimalSeparator, DuckDbStatus, DuckDbTableKind } from '../../../../../src/shared/messages/duckdb';
import type { CsvGridController } from '../../../types';
import { createRememberedSignal } from '../../../remembered';
import { postMessage } from '../../../vscode';

const TABLE_KIND_KEY = 'tools.duckdb.tableKind';
const TABLE_NAME_KEY = 'tools.duckdb.tableName';
const DEFAULT_TABLE_NAME = 'data';

// DecimalSeparator enum (extension side): DOT=0, COMMAS=1, BOTH=2. DuckDB needs one concrete character,
// so a file detected as COMMAS seeds ',' while everything else (DOT, or an ambiguous BOTH) seeds '.'.
const DECIMAL_SEPARATOR_COMMAS = 1;

/**
 * Holds the Tools panel's state and assembles the {@link RunDuckDbRequestMessage}. The mount kind and
 * table name are remembered workspace-wide (extension-backed, via {@link createRememberedSignal}), so a
 * query session's setup survives reloads. The decimal separator is not remembered — it defaults to the
 * file's detected config (`CsvFileConfigMessage.decimalSeparator`) and can be overridden for the session.
 * Fire-and-forget: there is no reverse channel — failures surface as VS Code notifications from the host.
 */
export interface QueryController {
	tableKind: Accessor<DuckDbTableKind>;
	setTableKind: (kind: DuckDbTableKind) => void;
	tableName: Accessor<string>;
	setTableName: (name: string) => void;
	decimalSeparator: Accessor<DuckDbDecimalSeparator>;
	setDecimalSeparator: (separator: DuckDbDecimalSeparator) => void;
	duckDbStatus: Accessor<DuckDbStatus | null>;
	checkDuckDb: () => void;
	handleDuckDbStatus: (status: DuckDbStatus) => void;
	runDuckDb: () => void;
}

export function createQueryController(grid: CsvGridController): QueryController {
	const tableKind = createRememberedSignal<DuckDbTableKind>(TABLE_KIND_KEY, { scope: 'global', default: 'table' });
	const tableName = createRememberedSignal<string>(TABLE_NAME_KEY, { scope: 'global', default: DEFAULT_TABLE_NAME });

	// `null` follows the file's detected separator; choosing one pins an override for the session.
	const [decimalOverride, setDecimalOverride] = createSignal<DuckDbDecimalSeparator | null>(null);
	const detectedDecimalSeparator = (): DuckDbDecimalSeparator =>
		grid.csvConfig()?.decimalSeparator === DECIMAL_SEPARATOR_COMMAS ? ',' : '.';
	const decimalSeparator = (): DuckDbDecimalSeparator => decimalOverride() ?? detectedDecimalSeparator();
	const [duckDbStatus, setDuckDbStatus] = createSignal<DuckDbStatus | null>(null);

	let requestCounter = 0;

	return {
		tableKind: tableKind.value,
		setTableKind: tableKind.set,
		tableName: tableName.value,
		setTableName: tableName.set,
		decimalSeparator,
		setDecimalSeparator: separator => setDecimalOverride(separator),
		duckDbStatus,
		checkDuckDb: () => {
			setDuckDbStatus(null);
			postMessage({ type: 'checkDuckDb' });
		},
		handleDuckDbStatus: status => setDuckDbStatus(status),
		runDuckDb: () => {
			const name = tableName.value().trim() === '' ? DEFAULT_TABLE_NAME : tableName.value().trim();
			postMessage({
				type: 'runDuckDb',
				requestId: `duckdb-${Date.now()}-${requestCounter++}`,
				tableKind: tableKind.value(),
				tableName: name,
				decimalSeparator: decimalSeparator()
			});
		}
	};
}
