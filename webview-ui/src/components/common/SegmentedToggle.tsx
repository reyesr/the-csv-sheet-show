import { For, type JSX } from 'solid-js';
import { cn } from '../../cn';

export interface SegmentedOption<T extends string> {
	value: T;
	label: JSX.Element;
	title?: string;
}

/**
 * Segmented toggle (Design System §07): 2–3 mutually-exclusive modes in a bordered group.
 * The active segment fills with the primary token; inactive segments are quiet text that
 * reveal a hover wash. Used for Navigate / Filter and for column alignment.
 */
export function SegmentedToggle<T extends string>(props: {
	options: SegmentedOption<T>[];
	value: T;
	onChange: (value: T) => void;
	'aria-label'?: string;
	class?: string;
}) {
	return (
		<div
			role="radiogroup"
			aria-label={props['aria-label']}
			class={cn('inline-flex overflow-hidden rounded-sm border border-border vscode-high-contrast:border-focus', props.class)}
		>
			<For each={props.options}>
				{option => {
					const selected = (): boolean => props.value === option.value;
					return (
						<button
							type="button"
							role="radio"
							aria-checked={selected()}
							title={option.title}
							class={cn(
								'h-7 px-3 text-control  cursor-pointer',
								selected()
									? 'bg-primary font-medium text-primary-fg'
									: 'bg-transparent text-fg-muted hover:bg-hover'
							)}
							onMouseDown={event => event.preventDefault()}
							onClick={() => props.onChange(option.value)}
						>
							{option.label}
						</button>
					);
				}}
			</For>
		</div>
	);
}
