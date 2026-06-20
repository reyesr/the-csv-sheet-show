import { createContext, createSignal, createUniqueId, For, JSX, onCleanup, onMount, Show, useContext } from 'solid-js';
import { cn } from '../../cn';
import { CaretIcon } from './icons';

type ActionEntry = {
	id: string;
	value: () => string | undefined;
	action: () => void;
	disabled: () => boolean | undefined;
	isMain: () => boolean | undefined;
	content: () => JSX.Element;
};

const SplitButtonContext = createContext<{
	register: (entry: ActionEntry) => void;
	unregister: (id: string) => void;
}>();

const ZONE_BASE = 'text-[12px] disabled:opacity-50 disabled:cursor-default';

const VARIANT_CLASS = {
	primary:
		'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] enabled:hover:bg-[var(--vscode-button-hoverBackground)]',
	secondary:
		'bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] enabled:hover:bg-[var(--vscode-button-secondaryHoverBackground)]',
} as const;

/**
 * A button that pairs a default action (left zone, fires immediately) with a chevron
 * (right zone) that opens a menu of related alternative actions.
 *
 * Actions are declared as `<SplitButtonAction>` children — the first becomes the primary
 * (left) zone unless one sets `isMain`, and the rest become dropdown menu items. Each child's
 * content may be plain text or any component.
 *
 * Pass `remember` to make whichever action the user picks the new default (it fills the primary
 * zone on later renders). Persistence is the caller's job: pass `defaultValue` to seed the default
 * and `onSelect` to be notified of each pick (e.g. to store it). Remembered actions are matched by
 * their `value`, so give each `<SplitButtonAction>` a stable `value` when memory is enabled.
 *
 * @example
 * <SplitButton>
 * 	<SplitButtonAction action={save}>Save</SplitButtonAction>
 * 	<SplitButtonAction action={saveDraft}>Save as draft</SplitButtonAction>
 * 	<SplitButtonAction action={saveCopy} disabled={!canCopy}>Save a copy</SplitButtonAction>
 * </SplitButton>
 */
export function SplitButton(props: {
	/** `<SplitButtonAction>` children. The first is the default action (unless one sets `isMain`), the rest fill the menu. */
	children: JSX.Element;
	/**
	 * When true, the action the user picks becomes the default (primary zone) on later renders.
	 * Implied by `defaultValue`/`onSelect`. The picked action is identified by its `value`, so set
	 * one on each child.
	 */
	remember?: boolean;
	/**
	 * Initial remembered value, used to seed the primary zone. Matched against each action's
	 * `value`; a value no longer present falls through to the `isMain`/first default. Implies
	 * `remember`.
	 */
	defaultValue?: string;
	/**
	 * Called with the chosen action's `value` whenever a valued action is picked, letting the caller
	 * persist it (e.g. via the workspace metadata store). Implies `remember`.
	 */
	onSelect?: (value: string) => void;
	/** Visual style of the control. Defaults to 'primary'. */
	variant?: 'primary' | 'secondary';
	/** Disables both zones. */
	disabled?: boolean;
	/** Accessible label for the primary zone. */
	'aria-label'?: string;
	/** Accessible label for the chevron trigger. Defaults to 'More actions'. */
	menuLabel?: string;
	/** Extra classes merged onto the outer wrapper via cn(). */
	class?: string;
}) {
	let rootElement: HTMLDivElement | undefined;
	const [open, setOpen] = createSignal(false);
	const [entries, setEntries] = createSignal<ActionEntry[]>([]);

	const ctx = {
		register: (entry: ActionEntry) => setEntries(prev => [...prev, entry]),
		unregister: (id: string) => setEntries(prev => prev.filter(entry => entry.id !== id)),
	};

	const rememberEnabled = (): boolean =>
		props.remember === true || props.defaultValue !== undefined || props.onSelect !== undefined;
	// Seeded from the caller's `defaultValue`; a remembered value no longer present falls through to
	// the isMain/first default below.
	const [chosenValue, setChosenValue] = createSignal<string | undefined>(props.defaultValue);

	const variantClass = (): string => VARIANT_CLASS[props.variant ?? 'primary'];
	const primary = (): ActionEntry | undefined => {
		if (rememberEnabled()) {
			const chosen = chosenValue();
			const remembered = chosen !== undefined ? entries().find(entry => entry.value() === chosen) : undefined;
			if (remembered !== undefined) return remembered;
		}
		return entries().find(entry => entry.isMain()) ?? entries()[0];
	};
	const menuItems = (): ActionEntry[] => {
		const main = primary();
		return entries().filter(entry => entry.id !== main?.id);
	};

	/** Invoke an action, recording it as the remembered default and notifying `onSelect` so the caller can persist it. */
	function select(entry: ActionEntry): void {
		if (rememberEnabled()) {
			const value = entry.value();
			if (value !== undefined) {
				setChosenValue(value);
				props.onSelect?.(value);
			}
		}
		entry.action();
	}

	onMount(() => {
		const onPointerDown = (event: PointerEvent): void => {
			if (!open()) return;
			const target = event.target;
			if (target instanceof Node && rootElement?.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape' && open()) {
				event.preventDefault();
				setOpen(false);
			}
		};

		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('keydown', onKeyDown, true);
		onCleanup(() => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKeyDown, true);
		});
	});

	function runItem(item: ActionEntry): void {
		if (item.disabled() === true) return;
		select(item);
		setOpen(false);
	}

	return (
		<SplitButtonContext.Provider value={ctx}>
			{/* Children render nothing themselves; they register their action + content here. */}
			{props.children}

			<div ref={element => { rootElement = element; }} class={cn('relative inline-flex', props.class ? props.class : '')}>
				{/* Button group: overflow-hidden clips the two zones to the rounded corners. It must NOT
				    be the menu's positioning context, or the popup (rendered below) would be clipped too. */}
				<div class="inline-flex items-stretch overflow-hidden rounded-sm border border-[var(--vscode-button-border,transparent)] vscode-high-contrast:border-[var(--vscode-focusBorder)]">
					<button
						type="button"
						class={cn(ZONE_BASE, variantClass(), 'px-2 py-1')}
						aria-label={props['aria-label']}
						disabled={props.disabled || primary() === undefined || primary()?.disabled() === true}
						onMouseDown={event => event.preventDefault()}
						onClick={() => { const item = primary(); if (item) select(item); }}
					>
						{primary()?.content()}
					</button>

					<span aria-hidden="true" class="w-px shrink-0 self-stretch bg-[var(--vscode-button-border,var(--vscode-panel-border))] opacity-40" />

					<button
						type="button"
						class={cn(ZONE_BASE, variantClass(), 'px-1.5 py-1')}
						aria-haspopup="menu"
						aria-expanded={open()}
						aria-label={props.menuLabel ?? 'More actions'}
						disabled={props.disabled || menuItems().length === 0}
						onMouseDown={event => event.preventDefault()}
						onClick={() => setOpen(value => !value)}
					>
						<CaretIcon class={cn('h-3.5 w-3.5', open() && 'rotate-180')} />
					</button>
				</div>

				<Show when={open()}>
					<div
						role="menu"
						class="absolute right-0 top-full z-50 mt-1 min-w-[10rem] rounded-sm border border-[var(--vscode-menu-border,var(--vscode-panel-border))] bg-[var(--vscode-menu-background,var(--vscode-editor-background))] py-1 text-base text-[var(--vscode-menu-foreground,var(--vscode-foreground))] shadow-elevated"
					>
						<For each={menuItems()}>
							{item => (
								<button
									type="button"
									role="menuitem"
									disabled={item.disabled()}
									class="block w-full cursor-pointer px-3 py-1 text-left hover:bg-[var(--vscode-menu-selectionBackground,var(--vscode-list-activeSelectionBackground))] hover:text-[var(--vscode-menu-selectionForeground,var(--vscode-list-activeSelectionForeground))] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
									onMouseDown={event => event.preventDefault()}
									onClick={() => runItem(item)}
								>
									{item.content()}
								</button>
							)}
						</For>
					</div>
				</Show>
			</div>
		</SplitButtonContext.Provider>
	);
}

/**
 * One action inside a `<SplitButton>`. Renders no markup itself — it registers its
 * `action` and content (children) with the parent, which places the primary action in the
 * primary zone and the rest in the dropdown menu. The first child is primary unless an action
 * sets `isMain`.
 */
export function SplitButtonAction(props: {
	/** Invoked when this action is chosen (primary click or menu selection). */
	action: () => void;
	/**
	 * Stable identifier for this action, used to remember/persist it as the default when the parent
	 * `<SplitButton>` enables memory (`remember`/`defaultValue`/`onSelect`). Keep it constant across
	 * sessions — unlike the internal unique id, this is what gets stored.
	 */
	value?: string;
	/** When true, this entry is non-interactive (greyed out in the menu / disabled left zone). */
	disabled?: boolean;
	/** When true, this action is the default — it fills the primary (left) zone instead of the
	 *  first child. If several are marked, the first marked wins. */
	isMain?: boolean;
	/** Content shown for the action — plain text or any component. */
	children: JSX.Element;
}) {
	const ctx = useContext(SplitButtonContext);
	if (!ctx) throw new Error('<SplitButtonAction> must be used inside <SplitButton>');

	const id = createUniqueId();
	ctx.register({
		id,
		value: () => props.value,
		action: () => props.action(),
		disabled: () => props.disabled,
		isMain: () => props.isMain,
		content: () => props.children,
	});
	onCleanup(() => ctx.unregister(id));

	return null;
}
