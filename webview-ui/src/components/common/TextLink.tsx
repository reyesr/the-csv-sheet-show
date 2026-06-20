import type { JSX } from 'solid-js';
import { cn } from '../../cn';

/**
 * Link-style action (Design System §07): uses `textLink-foreground` with a hover wash, for
 * low-emphasis inline actions like Select all / Clear / Reset. Reads as a link, not a button.
 */
export function TextLink(props: {
	onClick?: (event: MouseEvent) => void;
	onMouseDown?: (event: MouseEvent) => void;
	disabled?: boolean;
	title?: string;
	class?: string;
	children: JSX.Element;
}) {
	return (
		<button
			type="button"
			class={cn(
				'rounded-sm px-1.5 py-0.5 text-link hover:bg-hover disabled:text-[var(--vscode-disabledForeground)] disabled:hover:bg-transparent',
				props.class
			)}
			disabled={props.disabled}
			title={props.title}
			onMouseDown={props.onMouseDown}
			onClick={event => props.onClick?.(event)}
		>
			{props.children}
		</button>
	);
}
