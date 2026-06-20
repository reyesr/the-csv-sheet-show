import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { cn } from '../../cn';
import { CaretIcon, CheckIcon } from './icons';
import { TextLink } from './TextLink';

export type MultiSelectValue = string | number;

export interface MultiSelectOption {
	value: MultiSelectValue;
	label: string;
	description?: string;
}

/** Lists longer than this gain a search field at the top of the dropdown. */
const SEARCH_THRESHOLD = 7;

export function MultiSelect(props: {
	/** Text shown before the summary on the trigger and as the dropdown heading. Omit when an outer
	 * `<Field>` supplies the label — pass `aria-labelledby` instead so the trigger stays named. */
	label?: string;
	options: MultiSelectOption[];
	selectedValues: MultiSelectValue[];
	summary: string;
	onToggle: (value: MultiSelectValue) => void;
	onClear: () => void;
	/** When provided, shows a "Select all" link in the dropdown header. */
	onSelectAll?: () => void;
	/** Trigger id — pairs with a `<Field>` / `<Label>` `for`. */
	id?: string;
	/** ARIA: id(s) of the element(s) labelling the trigger (e.g. a `<Field>` label). */
	'aria-labelledby'?: string;
	/** ARIA: id(s) of helper / error text describing the control. */
	'aria-describedby'?: string;
	/** ARIA: marks the control invalid; also paints the trigger's error border. */
	'aria-invalid'?: boolean;
}) {
	let rootElement: HTMLDivElement | undefined;
	let searchEl: HTMLInputElement | undefined;
	let pointerDownInside = false;
	const [open, setOpen] = createSignal(false);
	const [query, setQuery] = createSignal('');
	const selectedValueSet = createMemo(() => new Set(props.selectedValues));
	const hasSelection = createMemo(() => props.selectedValues.length > 0);
	const allSelected = createMemo(() => props.options.length > 0 && props.selectedValues.length >= props.options.length);
	const searchable = createMemo(() => props.options.length > SEARCH_THRESHOLD);
	const filteredOptions = createMemo(() => {
		const needle = query().trim().toLowerCase();
		if (needle === '') return props.options;
		return props.options.filter(option =>
			option.label.toLowerCase().includes(needle) || (option.description?.toLowerCase().includes(needle) ?? false));
	});

	// Reset and focus the search field each time the dropdown opens.
	createEffect(() => {
		if (open()) {
			setQuery('');
			if (searchable()) {
				queueMicrotask(() => searchEl?.focus());
			}
		}
	});

	function closeOnEscape(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			setOpen(false);
		}
	}

	function closeOnFocusOut(event: FocusEvent): void {
		const nextTarget = event.relatedTarget;
		if (nextTarget instanceof Node && rootElement?.contains(nextTarget)) {
			return;
		}

		queueMicrotask(() => {
			const activeElement = document.activeElement;
			if (pointerDownInside || (activeElement instanceof Node && rootElement?.contains(activeElement))) {
				return;
			}

			setOpen(false);
		});
	}

	function trackPointerDownInside(): void {
		pointerDownInside = true;
		window.setTimeout(() => {
			pointerDownInside = false;
		}, 0);
	}

	function closeOnDocumentPointerDown(event: PointerEvent): void {
		const target = event.target;
		if (!open() || (target instanceof Node && rootElement?.contains(target))) {
			return;
		}

		setOpen(false);
	}

	function closeOnWindowBlur(): void {
		setOpen(false);
	}

	onMount(() => {
		document.addEventListener('pointerdown', closeOnDocumentPointerDown);
		window.addEventListener('blur', closeOnWindowBlur);
		onCleanup(() => document.removeEventListener('pointerdown', closeOnDocumentPointerDown));
		onCleanup(() => window.removeEventListener('blur', closeOnWindowBlur));
	});

	return (
		<div ref={element => { rootElement = element; }} class="relative" onKeyDown={closeOnEscape} onFocusOut={closeOnFocusOut} onPointerDown={trackPointerDownInside}>
			<button
				class={cn(
					'flex h-7 items-center gap-2 rounded-sm border border-border bg-secondary px-2 text-control text-secondary-fg hover:bg-secondary-hover vscode-high-contrast:border-focus cursor-pointer',
					props['aria-invalid'] && 'border-error-border vscode-high-contrast:border-error-border',
				)}
				type="button"
				id={props.id}
				aria-haspopup="listbox"
				aria-expanded={open()}
				aria-labelledby={props['aria-labelledby']}
				aria-describedby={props['aria-describedby']}
				aria-invalid={props['aria-invalid']}
				onClick={() => setOpen(value => !value)}
			>
				<Show when={props.label !== undefined}>
					<span class="text-fg-muted">{props.label}</span>
				</Show>
				<span>{props.summary}</span>
				<CaretIcon class={`h-3.5 w-3.5 shrink-0 text-fg-muted ${open() ? 'rotate-180' : ''}`} />
			</button>

			<Show when={open()}>
				<div class="absolute right-0 top-8 z-50 w-72 overflow-hidden rounded-sm border border-border bg-widget text-control shadow-elevated vscode-high-contrast:border-focus">
					<div class="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5 text-label text-fg-muted vscode-high-contrast:border-focus">
						<span>{props.label}</span>
						<span class="flex items-center gap-1">
							<Show when={props.onSelectAll !== undefined}>
								<TextLink disabled={allSelected()} onClick={() => props.onSelectAll?.()}>Select all</TextLink>
							</Show>
							<TextLink disabled={!hasSelection()} onClick={props.onClear}>Clear</TextLink>
						</span>
					</div>
					<Show when={searchable()}>
						<div class="border-b border-border p-1.5 vscode-high-contrast:border-focus">
							<input
								ref={element => { searchEl = element; }}
								class="w-full rounded-sm border border-input-border bg-input px-2 py-1 text-input-fg vscode-high-contrast:border-focus"
								type="text"
								placeholder="Search…"
								value={query()}
								onInput={event => setQuery(event.currentTarget.value)}
							/>
						</div>
					</Show>
					<div class="max-h-72 overflow-auto py-1" role="listbox" aria-multiselectable="true" aria-labelledby={props['aria-labelledby']}>
						<For each={filteredOptions()}>
							{option => (
								<label class={cn('flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-hover has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:-outline-offset-1 has-[:focus-visible]:outline-focus', selectedValueSet().has(option.value) && 'bg-sel text-sel-fg hover:bg-sel')}>
									<input
										class="sr-only"
										type="checkbox"
										checked={selectedValueSet().has(option.value)}
										onChange={() => props.onToggle(option.value)}
									/>
									<span class="min-w-0 flex-1">
										<span class="block truncate">{option.label}</span>
										<Show when={option.description !== undefined}>
											<span class="block truncate text-label text-fg-muted">{option.description}</span>
										</Show>
									</span>
									<Show when={selectedValueSet().has(option.value)}>
										<CheckIcon class="h-3.5 w-3.5 shrink-0" />
									</Show>
								</label>
							)}
						</For>
						<Show when={searchable() && filteredOptions().length === 0}>
							<div class="px-2 py-2 text-label text-fg-muted">No matches</div>
						</Show>
					</div>
				</div>
			</Show>
		</div>
	);
}
