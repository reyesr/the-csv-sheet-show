import { Accessor, Show } from 'solid-js';
import { Field } from '../../common/Field';
import { Select } from '../../common/Select';
import type { JsonExportOptions } from '../createExportController';

/**
 * JSON-specific format options, extracted from {@link ExportPanel} (architecture.md §4.3). The panel
 * decides *when* to render this (only for the JSON exporter); this component owns the controls and
 * reads/writes them through the export controller's `json` accessor and `setJson` patch setter.
 */
export function JsonOptionsPane(props: {
	json: Accessor<JsonExportOptions>;
	setJson: (patch: Partial<JsonExportOptions>) => void;
}) {
	return (
		<div class="mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3 vscode-high-contrast:border-focus">
			<Field label="Shape" class="min-w-[120px]">
				{control => (
					<Select
						{...control}
						options={[{ value: 'objects', label: 'Array of objects' }, { value: 'arrays', label: 'Array of arrays' }, { value: 'ndjson', label: 'NDJSON (one per line)' }]}
						selectedValue={props.json().shape}
						onSelect={value => props.setJson({ shape: value as JsonExportOptions['shape'] })}
					/>
				)}
			</Field>
			<Field label="Indent" class="min-w-[110px]">
				{control => (
					<Select
						{...control}
						options={[{ value: 0, label: 'Minified' }, { value: 2, label: '2 spaces' }, { value: 4, label: '4 spaces' }, { value: '\t', label: 'Tab' }]}
						selectedValue={props.json().indent}
						onSelect={value => props.setJson({ indent: value as JsonExportOptions['indent'] })}
					/>
				)}
			</Field>
			<Field label="Empty cells" class="min-w-[120px]">
				{control => (
					<Select
						{...control}
						options={[{ value: 'null', label: 'null' }, { value: 'empty-string', label: 'Empty string' }, { value: 'omit', label: 'Omit key' }]}
						selectedValue={props.json().emptyAs}
						onSelect={value => props.setJson({ emptyAs: value as JsonExportOptions['emptyAs'] })}
					/>
				)}
			</Field>
			<Field label="Keys" class="min-w-[120px]">
				{control => (
					<Select
						{...control}
						options={[{ value: 'header', label: 'Header name' }, { value: 'as-is', label: 'As-is' }, { value: 'camelCase', label: 'camelCase' }, { value: 'snake_case', label: 'snake_case' }]}
						selectedValue={props.json().keyStyle}
						onSelect={value => props.setJson({ keyStyle: value as JsonExportOptions['keyStyle'] })}
					/>
				)}
			</Field>
			<Show when={props.json().shape === 'arrays'}>
				<label class="flex h-7 cursor-pointer items-center gap-2 text-control">
					<input
						type="checkbox"
						class="h-3.5 w-3.5 accent-primary"
						checked={props.json().includeHeaderRow}
						onChange={event => props.setJson({ includeHeaderRow: event.currentTarget.checked })}
					/>
					<span>Header row</span>
				</label>
			</Show>
		</div>
	);
}
