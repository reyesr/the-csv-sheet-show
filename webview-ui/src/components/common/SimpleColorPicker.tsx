import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';

const GRID_COLUMNS = 7;
const RGB_FIELD_SLOTS = 4;
const MAX_PALETTE_COLORS = 17;

export function SimpleColorPicker(props: {
	label: string;
	color: string;
	palette: string[];
	onChange: (color: string) => void;
}) {
	let rootElement: HTMLDivElement | undefined;
	let inputElement: HTMLInputElement | undefined;
	const [open, setOpen] = createSignal(false);
	const [draftValue, setDraftValue] = createSignal(props.color);
	const renderedPalette = createMemo(() => props.palette.slice(0, MAX_PALETTE_COLORS));

	const spacerSlots = createMemo(() => {
		const usedSlots = renderedPalette().length % GRID_COLUMNS;
		if (usedSlots === 0) {
			return 0;
		}

		const freeSlots = GRID_COLUMNS - usedSlots;
		return freeSlots >= RGB_FIELD_SLOTS ? 0 : freeSlots;
	});

	createEffect(() => {
		if (!open()) {
			setDraftValue(props.color);
		}
	});

	function toggleOpen(): void {
		if (open()) {
			setOpen(false);
			return;
		}

		setDraftValue(props.color);
		setOpen(true);
		queueMicrotask(() => inputElement?.select());
	}

	function chooseColor(color: string): void {
		props.onChange(color);
		setOpen(false);
	}

	function submitDraft(): void {
		const color = parseColorDescriptor(draftValue());
		if (color === null) {
			return;
		}

		chooseColor(color);
	}

	function applyDraftIfValid(value: string): void {
		setDraftValue(value);

		const color = parseColorDescriptor(value);
		if (color !== null && !isSameColor(color, props.color)) {
			props.onChange(color);
		}
	}

	function closeOnOutsidePointerDown(event: PointerEvent): void {
		const target = event.target;
		if (!open() || (target instanceof Node && rootElement?.contains(target))) {
			return;
		}

		setOpen(false);
	}

	function closeOnEscape(event: KeyboardEvent): void {
		if (event.key !== 'Escape') {
			return;
		}

		event.preventDefault();
		setOpen(false);
	}

	onMount(() => {
		document.addEventListener('pointerdown', closeOnOutsidePointerDown);
		onCleanup(() => document.removeEventListener('pointerdown', closeOnOutsidePointerDown));
	});

	return (
		<div ref={element => { rootElement = element; }} class="min-w-0" onKeyDown={closeOnEscape}>
			<div class="flex items-center justify-between gap-3">
				<span class="text-[12px] text-[var(--vscode-foreground)]">{props.label}</span>
				<button
					class="h-6 w-10 rounded-md border border-[var(--vscode-panel-border)] shadow-sm hover:border-[var(--vscode-focusBorder)] vscode-high-contrast:border-[var(--vscode-focusBorder)]"
					type="button"
					aria-label={`${props.label}: ${props.color}`}
					aria-expanded={open()}
					onClick={toggleOpen}
					style={{ 'background-color': props.color }}
				/>
			</div>

			<Show when={open()}>
				<div class="mt-2 grid grid-cols-7 gap-1">
					<For each={renderedPalette()}>
						{color => (
							<button
								class={colorButtonClass(isSameColor(color, props.color))}
								type="button"
								aria-label={`Choose ${color}`}
								onClick={() => chooseColor(color)}
								style={{ 'background-color': color }}
							/>
						)}
					</For>
					<Show when={spacerSlots() > 0}>
						<div aria-hidden="true" style={{ 'grid-column': `span ${spacerSlots()} / span ${spacerSlots()}` }} />
					</Show>
					<input
						ref={element => { inputElement = element; }}
						class="col-span-4 h-7 rounded-md border border-[var(--vscode-input-border,var(--vscode-panel-border))] bg-[var(--vscode-input-background)] px-1.5 text-[11px] text-[var(--vscode-input-foreground)] outline-none focus:border-[var(--vscode-focusBorder)]"
						type="text"
						placeholder="rgb(0, 0, 0) or #000000"
						value={draftValue()}
						onInput={event => applyDraftIfValid(event.currentTarget.value)}
						onKeyDown={event => {
							if (event.key === 'Enter') {
								event.preventDefault();
								submitDraft();
							}
						}}
					/>
				</div>
			</Show>
		</div>
	);
}

function colorButtonClass(selected: boolean): string {
	const base = 'h-7 rounded-md border shadow-sm hover:border-[var(--vscode-focusBorder)]';
	return selected
		? `${base} border-[var(--vscode-focusBorder)] ring-2 ring-[var(--vscode-focusBorder)] ring-offset-1 ring-offset-[var(--vscode-editorWidget-background,var(--vscode-sideBar-background))]`
		: `${base} border-[var(--vscode-panel-border)]`;
}

function isSameColor(left: string, right: string): boolean {
	return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function parseColorDescriptor(value: string): string | null {
	const trimmed = value.trim();

	const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
	if (hexMatch !== null) {
		const digits = hexMatch[1];
		const expanded = digits.length === 3
			? digits.replace(/./g, char => char + char)
			: digits;
		return `#${expanded.toLowerCase()}`;
	}

	const rgbMatch = /^rgb\((.*)\)$/i.exec(trimmed);
	const channelsText = rgbMatch?.[1] ?? trimmed;
	const channels = channelsText.split(',').map(channel => channel.trim());
	if (channels.length !== 3) {
		return null;
	}

	const values = channels.map(channel => Number(channel));
	if (values.some(channel => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
		return null;
	}

	return `rgb(${values[0]}, ${values[1]}, ${values[2]})`;
}
