import type { JSX } from 'solid-js';
import { cn } from '../../cn';

/**
 * Icon-only control (Design System §07): 20px hit area, no border at rest, revealing
 * `list-hoverBackground` on hover. A `title` is required and doubles as the accessible label,
 * since there is no visible text. Used for the column gear, formula lock and find option chips.
 */
export function IconButton(props: {
	icon: JSX.Element;
	/** Required: tooltip + `aria-label`. */
	title: string;
	/** Marks the control as currently engaged (e.g. an open panel). */
	active?: boolean;
	disabled?: boolean;
	'aria-pressed'?: boolean;
	'aria-expanded'?: boolean;
	'aria-haspopup'?: boolean | 'menu' | 'listbox' | 'dialog' | 'grid' | 'tree';
	/** Extra classes merged via cn(). */
	class?: string;
	onClick?: (event: MouseEvent) => void;
	onMouseDown?: (event: MouseEvent) => void;
}) {
	return (
		<button
			type="button"
			class={cn(
				'inline-flex h-5 w-5 items-center justify-center rounded-sm border border-transparent text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50 vscode-high-contrast:border-focus',
				props.active && 'bg-hover text-fg',
				props.class
			)}
			title={props.title}
			aria-label={props.title}
			aria-pressed={props['aria-pressed']}
			aria-expanded={props['aria-expanded']}
			aria-haspopup={props['aria-haspopup']}
			disabled={props.disabled}
			onMouseDown={props.onMouseDown}
			onClick={event => props.onClick?.(event)}
		>
			{props.icon}
		</button>
	);
}
