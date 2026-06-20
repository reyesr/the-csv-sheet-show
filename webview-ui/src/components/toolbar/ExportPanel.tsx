import { createMemo, For, Show } from 'solid-js';
import type { ExportFormat } from '../../../../src/shared/messages/export';
import type { CsvGridController } from '../../types';
import { Field } from '../common/Field';
import { ExportIcon } from '../common/icons';
import { MultiSelect } from '../common/MultiSelect';
import { SegmentedToggle, type SegmentedOption } from '../common/SegmentedToggle';
import { Select } from '../common/Select';
import { SplitButton, SplitButtonAction } from '../common/SplitButton';
import { splitButtonDefaultStore } from '../../vscode';
import type { ExportController } from './createExportController';
import { HtmlOptionsPane } from './exports/HtmlOptionsPane';
import { JsonOptionsPane } from './exports/JsonOptionsPane';
import { ExportOptionsHub } from './exports/ExportOptionsHub';

/**
 * Inline panel (§07) that docks below the command bar, mirroring {@link FormatPanel}. It is the full
 * export UI: pick the format, columns, row scope, optional per-column types and format parameters,
 * then export to a file or the clipboard. The original file is never modified. The controls shown
 * are driven by the active exporter's cached capability descriptor (architecture.md §4.3).
 */
export function ExportPanel(props: { export: ExportController; grid: CsvGridController }) {
	const ex = props.export;
	const exportDestination = splitButtonDefaultStore('export-destination');

	const columnLabel = (columnIndex: number): string =>
		props.grid.headerCells()[columnIndex]?.trim() || `Column ${columnIndex + 1}`;

	const columnOptions = createMemo(() =>
		Array.from({ length: props.grid.maxColumnCount() }, (_, index) => ({ value: index, label: columnLabel(index) })));

	const columnsSummary = createMemo(() => {
		const selected = ex.selectedColumns().length;
		return selected === 0 ? 'All columns' : `${selected} of ${props.grid.maxColumnCount()}`;
	});

	const scopeOptions = createMemo((): SegmentedOption<'all' | 'filtered'>[] => {
		const options: SegmentedOption<'all' | 'filtered'>[] = [{ value: 'all', label: 'All rows' }];
		if (ex.filterActive()) {
			options.push({ value: 'filtered', label: 'Filtered' });
		}
		return options;
	});

	const typeOptions = createMemo(() => ex.activeDescriptor()?.types.map(type => ({ value: type.id, label: type.label })) ?? []);

	const ready = (): boolean => props.grid.isFinal();

	return (
		<section
			class="rounded-sm border border-border bg-selected p-3 text-control text-fg vscode-high-contrast:border-focus"
			aria-label="Export"
		>
			<div class="mb-3 text-sm text-fg-muted">
				Convert the table to another format. The original file is left untouched.
			</div>

			<div class="flex flex-wrap items-end gap-3">
				<Field label="Format" class="min-w-[140px]">
					{control => (
						<Select
							{...control}
							fullWidth
							options={ex.exporters().map(descriptor => ({ value: descriptor.id, label: descriptor.id.toUpperCase(), description: descriptor.description }))}
							selectedValue={ex.format()}
							onSelect={value => ex.setFormat(value as ExportFormat)}
						/>
					)}
				</Field>

				<Field label="Columns" class="min-w-[160px]">
					{control => (
						<MultiSelect
							id={control.id}
							aria-labelledby={control['aria-labelledby']}
							options={columnOptions()}
							selectedValues={ex.selectedColumns()}
							summary={columnsSummary()}
							onToggle={value => ex.toggleColumn(Number(value))}
							onClear={ex.clearColumns}
							onSelectAll={ex.selectAllColumns}
						/>
					)}
				</Field>

				<Field label="Rows" class="min-w-[120px]">
					{() => (
						<SegmentedToggle
							aria-label="Row scope"
							options={scopeOptions()}
							value={ex.scope()}
							onChange={value => ex.setScope(value)}
						/>
					)}
				</Field>
			</div>

			<Show when={ex.activeDescriptor()?.features.typing}>
				<div class="mt-3 border-t border-border pt-3 vscode-high-contrast:border-focus">
					<label class="flex w-fit cursor-pointer items-center gap-2 text-control">
						<input
							type="checkbox"
							class="h-3.5 w-3.5 accent-primary"
							checked={ex.typingEnabled()}
							onChange={event => ex.setTypingEnabled(event.currentTarget.checked)}
						/>
						<span>Assign column types</span>
					</label>
					<Show
						when={ex.typingEnabled()}
						fallback={<p class="mt-1 text-label text-fg-muted">Every column is exported as text.</p>}
					>
						<div class="mt-2 flex max-h-48 flex-col gap-1 overflow-auto pr-1">
							<For each={ex.resolvedColumns()}>
								{columnIndex => (
									<div class="flex items-center gap-2">
										<span class="w-40 shrink-0 truncate text-sm" title={columnLabel(columnIndex)}>{columnLabel(columnIndex)}</span>
										<Select
											options={typeOptions()}
											selectedValue={ex.effectiveTypeId(columnIndex)}
											onSelect={value => ex.setColumnType(columnIndex, String(value))}
										/>
									</div>
								)}
							</For>
						</div>
					</Show>
				</div>
			</Show>

			<Show when={ex.activeDescriptor()?.features.alignment || ex.activeDescriptor()?.features.colors}>
				<div class="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-3 vscode-high-contrast:border-focus">
					<span class="text-label text-fg-muted">Retain styling from the grid:</span>
					<Show when={ex.activeDescriptor()?.features.alignment}>
						<label class="flex cursor-pointer items-center gap-2 text-control">
							<input
								type="checkbox"
								class="h-3.5 w-3.5 accent-primary"
								checked={ex.retainAlignment()}
								onChange={event => ex.setRetainAlignment(event.currentTarget.checked)}
							/>
							<span>Alignment</span>
						</label>
					</Show>
					<Show when={ex.activeDescriptor()?.features.colors}>
						<label class="flex cursor-pointer items-center gap-2 text-control">
							<input
								type="checkbox"
								class="h-3.5 w-3.5 accent-primary"
								checked={ex.retainColors()}
								onChange={event => ex.setRetainColors(event.currentTarget.checked)}
							/>
							<span>Colors</span>
						</label>
					</Show>
				</div>
			</Show>

			<ExportOptionsHub ex={ex} ready={ready} />

			<div class="mt-3 flex items-center gap-3 border-t border-border pt-3 vscode-high-contrast:border-focus">
				<SplitButton
					variant="primary"
					disabled={!ready() || ex.busy()}
					aria-label="Export to file"
					defaultValue={exportDestination.get()}
					onSelect={exportDestination.set}
					menuLabel="More export destinations"
				>
					<SplitButtonAction value="file" action={() => ex.exportToFile()}>
						<span class="inline-flex items-center gap-1"><ExportIcon class="h-3.5 w-3.5" />Export to file</span>
					</SplitButtonAction>
					<Show when={ex.activeDescriptor()?.features.clipboard}>
						<SplitButtonAction value="clipboard" action={() => ex.exportToClipboard()}>Copy to clipboard</SplitButtonAction>
					</Show>
				</SplitButton>

				<Show
					when={ready()}
					fallback={<span class="text-label text-fg-muted">Finish loading the file to export.</span>}
				>
					<span
						class="text-label"
						classList={{ 'text-error': ex.status() === 'error', 'text-fg-muted': ex.status() !== 'error' }}
						role={ex.status() === 'error' ? 'alert' : undefined}
					>
						{ex.statusMessage()}
					</span>
				</Show>
			</div>
		</section>
	);
}
