import { createSignal, JSX, onCleanup, onMount, Show } from 'solid-js';
import { Button } from './Button';
import { CaretIcon } from './icons';

/**
 * A button that toggles a floating panel below it (Design System §07 "Popover"): the standard
 * elevation-1 surface — `editorWidget-background`, hairline border, `rounded-sm`, the shared
 * elevated shadow — dismissed on outside-click or Escape.
 */
export function PanelPopupButton(props: {
	trigger: JSX.Element;
	children: JSX.Element;
	'aria-label'?: string;
	disabled?: boolean;
	/** Hides the trailing caret (e.g. when the trigger already shows one). */
	hideCaret?: boolean;
}) {
	const [isOpen, setIsOpen] = createSignal(false);
	let panelRef: HTMLDivElement | undefined;
	let rootRef: HTMLDivElement | undefined;

	onMount(() => {
		const onPointerDown = (event: PointerEvent) => {
			if (!isOpen()) return;
			const target = event.target as Node;
			if (rootRef && !rootRef.contains(target)) {
				setIsOpen(false);
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && isOpen()) {
				event.preventDefault();
				setIsOpen(false);
			}
		};

		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('keydown', onKeyDown, true);
		onCleanup(() => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKeyDown, true);
		});
	});

	return (
		<div ref={rootRef} class="relative">
			<Button
				variant={isOpen() ? 'primary' : 'secondary'}
				disabled={props.disabled}
				aria-haspopup="dialog"
				aria-expanded={isOpen()}
				icon={props.hideCaret ? undefined : <CaretIcon class="h-3.5 w-3.5" />}
				onMouseDown={event => event.preventDefault()}
				onClick={() => setIsOpen(open => !open)}
			>
				{props.trigger}
			</Button>

			<Show when={isOpen()}>
				<div
					ref={panelRef}
					role="dialog"
					aria-label={props['aria-label']}
					class="absolute left-0 top-full z-50 mt-1 rounded-sm border border-border bg-widget shadow-elevated vscode-high-contrast:border-focus"
				>
					{props.children}
				</div>
			</Show>
		</div>
	);
}
