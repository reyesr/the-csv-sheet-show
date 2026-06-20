import { Show, onMount } from 'solid-js';
import type { DuckDbDecimalSeparator, DuckDbTableKind } from '../../../../src/shared/messages/duckdb';
import type { CsvGridController } from '../../types';
import { Button } from '../common/Button';
import { Field } from '../common/Field';
import { Select } from '../common/Select';
import type { QueryController } from './query/createQueryController';

const TABLE_KIND_OPTIONS: { value: DuckDbTableKind; label: string; description: string }[] = [
	{ value: 'table', label: 'Temporary table', description: 'CREATE TABLE — a fast in-memory snapshot of the file' },
	{ value: 'view', label: 'Live view', description: 'CREATE VIEW — re-reads the file on each query' }
];

const DECIMAL_SEPARATOR_OPTIONS: { value: DuckDbDecimalSeparator; label: string; description: string }[] = [
	{ value: '.', label: 'Period (.)', description: 'Numbers like 1234.56' },
	{ value: ',', label: 'Comma (,)', description: 'Numbers like 1234,56' }
];

const INPUT_CLASS = 'h-7 w-full rounded-sm border border-input-border bg-input px-2 text-control text-input-fg outline-none focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus';

/**
 * Inline panel (§07) docked below the command bar's Tools control. It collects how the current file
 * should be mounted into DuckDB (a snapshot table or a live view, under a chosen name) and asks the
 * extension to open a terminal running the REPL. The choices are remembered per workspace.
 */
export function QueryPanel(props: { tools: QueryController; grid: CsvGridController }) {
	const ready = (): boolean => props.grid.csvConfig() !== null && props.grid.isFinal();
	const warningMessage = (): string | null => formatDuckDbWarning(props.tools.duckDbStatus());
	const duckDbUnavailable = (): boolean => {
		const status = props.tools.duckDbStatus();
		return status !== null && (!status.exists || !status.isExecutable);
	};
	const canRun = (): boolean => ready() && !duckDbUnavailable();
	const runTitle = (): string => {
		const warning = warningMessage();
		if (!ready()) {
			return 'Available once the file has finished loading';
		}
		return warning ?? 'Open a DuckDB terminal with this file loaded';
	};

	onMount(() => props.tools.checkDuckDb());

	return (
		<section
			class="rounded-sm border border-border bg-selected p-3 text-control text-fg vscode-high-contrast:border-focus"
			aria-label="Tools"
		>
			<div class="mb-3 text-sm text-fg-muted">
				Open a terminal running DuckDB with this file loaded, so you can query it with SQL.
			</div>
			<Show when={warningMessage()}>
				<div class="mb-3 text-control font-medium text-[#b00020] vscode-dark:text-[#d7ba7d] vscode-light:text-[#b00020] vscode-high-contrast:text-[#ffcc00]">
					{warningMessage()}
				</div>
			</Show>
			<div class="flex flex-wrap items-end gap-3">
				<Field label="Mount as" class="min-w-[150px]">
					{control => (
						<Select
							{...control}
							fullWidth
							options={TABLE_KIND_OPTIONS}
							selectedValue={props.tools.tableKind()}
							onSelect={value => props.tools.setTableKind(value as DuckDbTableKind)}
						/>
					)}
				</Field>
				<Field label="Table name" class="min-w-[160px]">
					{control => (
						<input
							{...control}
							type="text"
							class={INPUT_CLASS}
							value={props.tools.tableName()}
							placeholder="data"
							onInput={event => props.tools.setTableName(event.currentTarget.value)}
						/>
					)}
				</Field>
				<Field label="Decimal separator" class="min-w-[140px]">
					{control => (
						<Select
							{...control}
							fullWidth
							options={DECIMAL_SEPARATOR_OPTIONS}
							selectedValue={props.tools.decimalSeparator()}
							onSelect={value => props.tools.setDecimalSeparator(value as DuckDbDecimalSeparator)}
						/>
					)}
				</Field>
				<Button
					variant="primary"
					disabled={!canRun()}
					title={runTitle()}
					onClick={() => props.tools.runDuckDb()}
				>
					Run DuckDB
				</Button>
			</div>
		</section>
	);
}

function formatDuckDbWarning(status: ReturnType<QueryController['duckDbStatus']>): string | null {
	if (status === null || (status.exists && status.isExecutable)) {
		return null;
	}

	if (!status.exists) {
		return status.origin === 'settings'
			? `DuckDB was not found at "${status.path}" from csv-sheet-show.duckdbPath.`
			: 'DuckDB was not found on your PATH. Install DuckDB or set csv-sheet-show.duckdbPath.';
	}

	return status.origin === 'settings'
		? `DuckDB was found at "${status.path}", but it could not be executed.`
		: 'DuckDB was found on your PATH, but it could not be executed.';
}
