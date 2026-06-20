import { createUniqueId, JSX, Show } from 'solid-js';
import { cn } from '../../cn';
import { InfoIcon } from './icons';
import { Label } from './Label';

/** ARIA wiring handed to the control rendered inside a {@link Field}. Spread it onto the control. */
export interface FieldControl {
	/** Element id — pairs with the label's `for` and enables click-to-focus on native inputs. */
	id: string;
	/** Points the control at its visible label (for custom widgets that lack a native `<label>`). */
	'aria-labelledby': string;
	/** Points the control at its info / helper / error text, in reading order. */
	'aria-describedby': string | undefined;
	/** True while the field is in an error state. */
	'aria-invalid': true | undefined;
}

/**
 * A labelled form field (Design System §04/§07/§10): a {@link Label} above (or beside) a control,
 * with an optional info icon and helper / error text — all wired together for accessibility.
 *
 * The control is supplied as a render function so its ARIA attributes can be threaded onto whatever
 * widget it is — a native input, a `Select` or a `MultiSelect`. Spread the passed object onto it:
 *
 * @example
 * <Field label="Separator" info="The character between columns" helperText="Use Tab for TSV files.">
 *   {field => <Select {...field} options={separators} selectedValue={sep()} onSelect={setSep} />}
 * </Field>
 *
 * @example
 * <Field label="File name" error={nameError()}>
 *   {field => <input {...field} class={inputClass} type="text" value={name()} onInput={onName} />}
 * </Field>
 */
export function Field(props: {
	/** The field's visible label (sentence case, §09). */
	label: JSX.Element;
	/** Renders the control; spread the passed {@link FieldControl} onto it. */
	children: (control: FieldControl) => JSX.Element;
	/** Short note revealed by an info icon beside the label (hover tooltip + screen-reader text). */
	info?: string;
	/** Persistent guidance shown beneath the control. Replaced by `error` when that is set. */
	helperText?: JSX.Element;
	/** Error message shown beneath the control; also marks the control invalid. */
	error?: JSX.Element;
	/** `vertical` stacks the label above the control (default); `horizontal` sets it beside. */
	orientation?: 'vertical' | 'horizontal';
	/** Dims the label and info icon to match a disabled control. */
	disabled?: boolean;
	/** Base id for the field; derived ids hang off it. Auto-generated when omitted. */
	id?: string;
	/** Extra classes merged onto the outer wrapper via cn(). */
	class?: string;
}) {
	const base = props.id ?? createUniqueId();
	const controlId = `${base}-control`;
	const labelId = `${base}-label`;
	const infoId = `${base}-info`;
	const helperId = `${base}-helper`;
	const errorId = `${base}-error`;

	const horizontal = (): boolean => props.orientation === 'horizontal';

	// The ids describing the control, in reading order: the active message, then the info note.
	const describedBy = (): string | undefined => {
		const ids = [
			props.error !== undefined ? errorId : props.helperText !== undefined ? helperId : undefined,
			props.info !== undefined ? infoId : undefined,
		].filter((id): id is string => id !== undefined);
		return ids.length > 0 ? ids.join(' ') : undefined;
	};

	// Getters keep `aria-describedby` / `aria-invalid` reactive when the object is spread onto the control.
	const control: FieldControl = {
		id: controlId,
		'aria-labelledby': labelId,
		get 'aria-describedby'(): string | undefined {
			return describedBy();
		},
		get 'aria-invalid'(): true | undefined {
			return props.error !== undefined ? true : undefined;
		},
	};

	return (
		<div class={cn('flex flex-col gap-1', props.class)}>
			<div class={horizontal() ? 'flex flex-row items-center justify-between gap-2' : 'flex flex-col gap-1'}>
				<div class="flex items-center gap-1">
					<Label for={controlId} id={labelId} disabled={props.disabled}>{props.label}</Label>
					<Show when={props.info !== undefined}>
						<span
							class={cn('inline-flex text-fg-muted', props.disabled && 'opacity-50')}
							title={props.info}
							aria-hidden="true"
						>
							<InfoIcon class="h-3.5 w-3.5" />
						</span>
						<span id={infoId} class="sr-only">{props.info}</span>
					</Show>
				</div>
				<div class={cn('flex min-w-0 flex-col', horizontal() && 'items-end')}>
					{props.children(control)}
				</div>
			</div>

			<Show
				when={props.error !== undefined}
				fallback={
					<Show when={props.helperText !== undefined}>
						<p id={helperId} class="text-label text-fg-muted">{props.helperText}</p>
					</Show>
				}
			>
				<p id={errorId} class="text-label text-error" role="alert">{props.error}</p>
			</Show>
		</div>
	);
}
