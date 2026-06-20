import type { JSX } from 'solid-js';
import { cn } from '../../cn';
import { Button } from './Button';
import { CaretIcon } from './icons';

/**
 * Disclosure tab for an option panel (Design System §07): a labelled command-bar button with a
 * leading icon and a trailing caret that rotates 180° once its panel is open. Unlike
 * {@link PanelPopupButton} it owns no state and renders no surface of its own — the panel it
 * controls docks elsewhere in flow — so `open` / `onToggle` are driven by the parent. Stays
 * `secondary` even when open so the panel's own primary action keeps the single emphasis slot (§01).
 *
 * Bakes in `preventDefault` on mousedown so toggling the panel never steals focus from the grid.
 */
export function TabButton(props: {
	/** Controlled disclosure state of the panel this tab opens. */
	open: boolean;
	/** Toggle the panel open/closed. */
	onToggle: () => void;
	/** Leading icon, rendered before the label. */
	icon?: JSX.Element;
	/** Tooltip / accessible hint. */
	title?: string;
	disabled?: boolean;
	/** The tab label. */
	children?: JSX.Element;
}) {
	return (
		<Button
			icon={props.icon}
			title={props.title}
			disabled={props.disabled}
			aria-expanded={props.open}
			class={cn(props.open && 'bg-selected text-fg enabled:hover:bg-selected')}
			onMouseDown={event => event.preventDefault()}
			onClick={() => props.onToggle()}
		>
			{props.children}
			<CaretIcon class={cn('h-3.5 w-3.5', props.open && 'rotate-180')} />
		</Button>
	);
}
