import type { JSX } from 'solid-js';
import { cn } from '../../cn';

/**
 * Status badge (Design System §07): a non-interactive 9px uppercase mark on `badge-background`.
 * Status only — never a button. Used for the column "included in Find" badge.
 */
export function Badge(props: { children: JSX.Element; title?: string; 'aria-label'?: string; class?: string }) {
	return (
		<span
			class={cn(
				'inline-block rounded-sm border border-transparent bg-badge px-1 py-0.5 text-micro font-semibold uppercase leading-none tracking-wide text-badge-fg vscode-high-contrast:border-focus',
				props.class
			)}
			title={props.title}
			aria-label={props['aria-label']}
		>
			{props.children}
		</span>
	);
}
