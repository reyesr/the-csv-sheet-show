import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '../../cn';

/**
 * Standard action button (Design System §07): 28px tall, `rounded-sm`, optional leading icon.
 * `primary` carries the single emphasis colour (one per surface); `secondary` is the quiet
 * default for almost every control. Disabled controls stay in the layout at 50% opacity.
 */
export function Button(props: {
	/** Visual emphasis. Defaults to `secondary`. */
	variant?: 'primary' | 'secondary';
	/** Optional leading icon, rendered before the label with a 4px gap. */
	icon?: JSX.Element;
	/** Tooltip / accessible hint. */
	title?: string;
	disabled?: boolean;
	'aria-label'?: string;
	'aria-expanded'?: boolean;
	'aria-haspopup'?: boolean | 'menu' | 'listbox' | 'dialog' | 'grid' | 'tree';
	'aria-pressed'?: boolean;
	/** Extra classes merged via cn(). */
	class?: string;
	onClick?: (event: MouseEvent) => void;
	/** Passthrough — e.g. `event.preventDefault()` to keep grid focus from the toolbar. */
	onMouseDown?: (event: MouseEvent) => void;
	children?: JSX.Element;
}) {
	const variant = (): 'primary' | 'secondary' => props.variant ?? 'secondary';

	return (
		<button
			type="button"
			class={cn(
				'inline-flex h-7 items-center gap-1 rounded-sm border px-3 text-control disabled:opacity-50 vscode-high-contrast:border-focus cursor-pointer',
				variant() === 'primary'
					? 'border-transparent bg-primary font-medium text-primary-fg enabled:hover:bg-primary-hover'
					: 'border-transparent bg-secondary text-secondary-fg enabled:hover:bg-secondary-hover',
				props.class
			)}
			title={props.title}
			disabled={props.disabled}
			aria-label={props['aria-label']}
			aria-expanded={props['aria-expanded']}
			aria-haspopup={props['aria-haspopup']}
			aria-pressed={props['aria-pressed']}
			onMouseDown={props.onMouseDown}
			onClick={event => props.onClick?.(event)}
		>
			<Show when={props.icon}>{props.icon}</Show>
			{props.children}
		</button>
	);
}
