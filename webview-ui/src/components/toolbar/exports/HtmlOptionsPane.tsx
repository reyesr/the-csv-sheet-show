import { Accessor, Show } from 'solid-js';
import { Field } from '../../common/Field';
import { Select } from '../../common/Select';
import type { HtmlExportOptions } from '../createExportController';

/**
 * HTML-specific format options, extracted from {@link ExportPanel} (architecture.md §4.3). The panel
 * decides *when* to render this (only for the HTML exporter); this component owns the controls and
 * reads/writes them through the export controller's `html` accessor and `setHtml` patch setter.
 */
export function HtmlOptionsPane(props: {
	html: Accessor<HtmlExportOptions>;
	setHtml: (patch: Partial<HtmlExportOptions>) => void;
}) {
	return (
		<div class="mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3 vscode-high-contrast:border-focus">
			<Field label="Wrapping" class="min-w-[150px]">
				{control => (
					<Select
						{...control}
						options={[{ value: 'fragment', label: 'Table fragment' }, { value: 'styled-fragment', label: 'Styled fragment' }, { value: 'document', label: 'Full document' }]}
						selectedValue={props.html().wrap}
						onSelect={value => props.setHtml({ wrap: value as HtmlExportOptions['wrap'] })}
					/>
				)}
			</Field>
			<Show when={props.html().wrap !== 'fragment'}>
				<Field label="Styles" class="min-w-[130px]">
					{control => (
						<Select
							{...control}
							options={[{ value: 'classes', label: 'CSS classes' }, { value: 'inline', label: 'Inline styles' }]}
							selectedValue={props.html().styleMode}
							onSelect={value => props.setHtml({ styleMode: value as HtmlExportOptions['styleMode'] })}
						/>
					)}
				</Field>
			</Show>
			<Field label="Newlines" class="min-w-[140px]">
				{control => (
					<Select
						{...control}
						options={[{ value: 'pre-wrap', label: 'Preserve (pre-wrap)' }, { value: 'br', label: '<br> tags' }]}
						selectedValue={props.html().newline}
						onSelect={value => props.setHtml({ newline: value as HtmlExportOptions['newline'] })}
					/>
				)}
			</Field>
			<Field label="Table class" class="min-w-[140px]">
				{control => (
					<input
						{...control}
						type="text"
						class="h-7 w-full rounded-sm border border-input-border bg-input px-2 text-input-fg vscode-high-contrast:border-focus"
						value={props.html().tableClass}
						onInput={event => props.setHtml({ tableClass: event.currentTarget.value })}
					/>
				)}
			</Field>
			<label class="flex h-7 cursor-pointer items-center gap-2 text-control">
				<input
					type="checkbox"
					class="h-3.5 w-3.5 accent-primary"
					checked={props.html().includeHeaderRow}
					onChange={event => props.setHtml({ includeHeaderRow: event.currentTarget.checked })}
				/>
				<span>Header row</span>
			</label>
			<label class="flex h-7 cursor-pointer items-center gap-2 text-control">
				<input
					type="checkbox"
					class="h-3.5 w-3.5 accent-primary"
					checked={props.html().bordered}
					onChange={event => props.setHtml({ bordered: event.currentTarget.checked })}
				/>
				<span>Borders</span>
			</label>
		</div>
	);
}
