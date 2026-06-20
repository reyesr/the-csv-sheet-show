import type { Accessor } from 'solid-js';

/**
 * Save-progress indicator for the command bar's Actions zone (§08), shown only while a save runs
 * longer than the debounce delay. A quiet monospace percentage (§09) plus a thin bar tinted with the
 * focus accent; it never competes with the grid for attention.
 */
export function SaveProgressPanel(props: { percent: Accessor<number> }) {
	return (
		<div class="flex items-center gap-2" role="status" aria-live="polite">
			<span class="whitespace-nowrap font-mono text-label text-fg-muted">Saving… {props.percent()}%</span>
			<div
				class="h-1 w-16 overflow-hidden rounded-full bg-surface"
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={props.percent()}
			>
				<div
					class="h-full rounded-full bg-[var(--color-focus)] transition-[width] duration-150"
					style={{ width: `${props.percent()}%` }}
				/>
			</div>
		</div>
	);
}
