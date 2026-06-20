import type { JSX } from 'solid-js';
import { cn } from '../../cn';

/**
 * A form-control label (Design System §04/§09): the 11px label size, weight 500 and the
 * `descriptionForeground` colour, written in sentence case. Pair it with a control via `for`
 * (native inputs) or by giving it an `id` a custom widget can target with `aria-labelledby`.
 */
export function Label(props: {
	/** Associates the label with a control by id — enables click-to-focus on native inputs. */
	for?: string;
	/** Marks the label so a custom control can reference it via `aria-labelledby`. */
	id?: string;
	/** Dims the label to match a disabled control. */
	disabled?: boolean;
	/** Extra classes merged via cn(). */
	class?: string;
	children: JSX.Element;
}) {
	return (
		<label
			for={props.for}
			id={props.id}
			class={cn('text-label font-medium text-fg-muted', props.disabled && 'opacity-50', props.class)}
		>
			{props.children}
		</label>
	);
}
