import { createEffect, createMemo, createSignal, createUniqueId, For, onCleanup, onMount, Show } from 'solid-js';
import { cn } from '../../cn';
import { CaretIcon, CheckIcon } from './icons';
import { TextLink } from './TextLink';

export type SelectValue = string | number;

export interface SelectOption {
	value: SelectValue;
	label: string;
	description?: string;
}

export function Select(props: {
	/** Selectable options listed in the dropdown. */
	options: SelectOption[];
	/** Currently selected value. */
	selectedValue: SelectValue | undefined;
	/** Called with the chosen value when an option is selected. */
	onSelect: (value: SelectValue) => void;
	/** Text shown on the trigger when nothing is selected. */
	placeholder?: string;
	/** When provided, shows a "Clear" action in the dropdown that calls this. */
	onClear?: () => void;
	/** Stretches the trigger and dropdown to fill the available width. */
	fullWidth?: boolean;
	/** Extra classes merged onto the component's outer wrapper via cn(). */
	class?: string;
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
	let triggerEl: HTMLButtonElement | undefined;
	let panelEl: HTMLDivElement | undefined;
	let pointerDownInside = false;
	const groupId = createUniqueId();
	const [open, setOpen] = createSignal(false);
	const selectedOption = createMemo(() => props.options.find(option => option.value === props.selectedValue));
	const hasSelection = createMemo(() => props.selectedValue !== undefined && props.selectedValue !== '');
	const summary = createMemo(() => selectedOption()?.label ?? props.placeholder ?? 'Select…');

	// Place the popup where it best fits the viewport: flip up/down and shift
	// left/right so it never renders off-screen or clipped.
	function updatePosition(): void {
		const trigger = triggerEl;
		const panel = panelEl;
		if (trigger === undefined || panel === undefined) return;

		const gap = 4;
		const edge = 8;
		const vw = document.documentElement.clientWidth;
		const vh = window.innerHeight;
		const rect = trigger.getBoundingClientRect();

		// Measure the panel's natural size before constraining it. Width is driven by CSS
		// (w-max, clamped by max-w-[90vw]); for fullWidth we floor it at the trigger width so the
		// popup stays anchored but can still grow to fit its content.
		panel.style.maxHeight = '';
		panel.style.minWidth = props.fullWidth ? `${rect.width}px` : '';
		const desiredHeight = panel.offsetHeight;
		const panelWidth = panel.offsetWidth;

		// Vertical: prefer below, then above, otherwise the side with more room.
		const spaceBelow = vh - rect.bottom - gap - edge;
		const spaceAbove = rect.top - gap - edge;
		const placeBelow = desiredHeight <= spaceBelow || (desiredHeight > spaceAbove && spaceBelow >= spaceAbove);
		const maxHeight = Math.max(placeBelow ? spaceBelow : spaceAbove, 0);
		const height = Math.min(desiredHeight, maxHeight);
		const top = placeBelow ? rect.bottom + gap : rect.top - gap - height;

		// Horizontal: align to the trigger's left, then clamp into the viewport.
		let left = rect.left;
		if (left + panelWidth > vw - edge) left = vw - edge - panelWidth;
		if (left < edge) left = edge;

		panel.style.position = 'fixed';
		panel.style.top = `${Math.round(top)}px`;
		panel.style.left = `${Math.round(left)}px`;
		panel.style.maxHeight = `${Math.round(maxHeight)}px`;
		panel.style.visibility = 'visible';
	}

	createEffect(() => {
		if (!open()) return;
		// Position after the panel has mounted; visibility stays hidden until then.
		const frame = requestAnimationFrame(updatePosition);
		const handler = (): void => updatePosition();
		window.addEventListener('resize', handler);
		window.addEventListener('scroll', handler, true);
		onCleanup(() => {
			cancelAnimationFrame(frame);
			window.removeEventListener('resize', handler);
			window.removeEventListener('scroll', handler, true);
		});
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
		<div ref={element => { rootElement = element; }} class={cn('relative')} onKeyDown={closeOnEscape} onFocusOut={closeOnFocusOut} onPointerDown={trackPointerDownInside}>
			{/* Trigger styled as the §07 split button: an overflow-hidden rounded group whose label
			    zone and chevron zone are separated by a hairline divider (cf. SplitButton). */}
			<button
				ref={element => { triggerEl = element; }}
				class={cn(
					'inline-flex h-7 items-stretch overflow-hidden rounded-sm border border-border bg-secondary text-control text-secondary-fg hover:bg-secondary-hover vscode-high-contrast:border-focus cursor-pointer',
					props.fullWidth ? 'flex w-full' : '',
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
				<span class={cn('flex min-w-0 flex-1 items-center px-2 py-1', props.class)}>
					<span class="max-w-full truncate">{summary()}</span>
				</span>
				<span aria-hidden="true" class="w-px shrink-0 self-stretch bg-border opacity-40" />
				<span class="flex shrink-0 items-center px-1.5 py-1">
					<CaretIcon class={cn('h-3.5 w-3.5 text-fg-muted', open() && 'rotate-180')} />
				</span>
			</button>

			<Show when={open()}>
				<div
					ref={element => { panelEl = element; }}
					style={{ visibility: 'hidden' }}
					class={cn('fixed z-50 flex min-w-32 w-max max-w-[90vw] flex-col overflow-hidden rounded-sm border border-border bg-widget text-control shadow-elevated vscode-high-contrast:border-focus')}
				>
					<Show when={props.onClear !== undefined}>
						<div class="flex shrink-0 items-center justify-end border-b border-border px-2 py-1.5 text-label text-fg-muted vscode-high-contrast:border-focus">
							<TextLink disabled={!hasSelection()} onClick={() => props.onClear?.()}>Clear</TextLink>
						</div>
					</Show>
					<div class="min-h-0 flex-1 overflow-auto py-1" role="listbox" aria-labelledby={props['aria-labelledby']}>
						<For each={props.options}>
							{option => (
								<label class={cn('flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-hover has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:-outline-offset-1 has-[:focus-visible]:outline-focus', option.value === props.selectedValue && 'bg-sel text-sel-fg hover:bg-sel')}>
									<input
										class="sr-only"
										type="radio"
										name={groupId}
										checked={option.value === props.selectedValue}
										onChange={() => {
											props.onSelect(option.value);
											setOpen(false);
										}}
									/>
									<span class="min-w-0 flex-1">
										<span class="block">{option.label}</span>
										<Show when={option.description !== undefined}>
											<span class="block text-label text-fg-muted">{option.description}</span>
										</Show>
									</span>
									<Show when={option.value === props.selectedValue}>
										<CheckIcon class="h-3.5 w-3.5 shrink-0" />
									</Show>
								</label>
							)}
						</For>
					</div>
				</div>
			</Show>
		</div>
	);
}
