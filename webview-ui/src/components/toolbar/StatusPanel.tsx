import type { Accessor } from 'solid-js';

/**
 * The quiet row/column count in the command bar's Actions zone (§08). Numbers are monospace
 * with thousands separators (§09); the chrome never competes with the grid for attention.
 */
export function StatusPanel(props: { statsText: Accessor<string> }) {
	return (
		<span
			class="min-w-0 max-w-[16rem] truncate font-mono text-label text-fg-muted"
			role="status"
			aria-live="polite"
			title={props.statsText()}
		>
			{props.statsText()}
		</span>
	);
}
