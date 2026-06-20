import { createMemo, For, onCleanup, onMount } from 'solid-js';

export interface ContextMenuItem {
	label: string;
	action: () => void;
	disabled?: boolean;
}

const ESTIMATED_WIDTH = 200;
const ESTIMATED_ITEM_HEIGHT = 28;
const VIEWPORT_MARGIN = 8;

/**
 * A small floating menu shown at the pointer. Mounted only while open, it owns its dismissal
 * listeners so it tears them down automatically when it unmounts.
 */
export function CellContextMenu(props: {
	x: number;
	y: number;
	items: ContextMenuItem[];
	onClose: () => void;
}) {
	let element: HTMLDivElement | undefined;

	const position = createMemo(() => ({
		left: Math.min(props.x, window.innerWidth - ESTIMATED_WIDTH - VIEWPORT_MARGIN),
		top: Math.min(props.y, window.innerHeight - props.items.length * ESTIMATED_ITEM_HEIGHT - VIEWPORT_MARGIN)
	}));

	onMount(() => {
		const onPointerDown = (event: PointerEvent) => {
			if (element !== undefined && !element.contains(event.target as Node)) {
				props.onClose();
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				props.onClose();
			}
		};
		const close = () => props.onClose();

		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('keydown', onKeyDown, true);
		window.addEventListener('scroll', close, true);
		window.addEventListener('resize', close);
		window.addEventListener('blur', close);

		onCleanup(() => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKeyDown, true);
			window.removeEventListener('scroll', close, true);
			window.removeEventListener('resize', close);
			window.removeEventListener('blur', close);
		});
	});

	function runItem(item: ContextMenuItem): void {
		if (item.disabled === true) {
			return;
		}

		item.action();
		props.onClose();
	}

	return (
		<div
			ref={element}
			role="menu"
			class="fixed z-50 min-w-[10rem] rounded-sm border border-[var(--vscode-menu-border,var(--vscode-panel-border))] bg-[var(--vscode-menu-background,var(--vscode-editor-background))] py-1 text-base text-[var(--vscode-menu-foreground,var(--vscode-foreground))] shadow-elevated"
			style={{ left: `${Math.max(VIEWPORT_MARGIN, position().left)}px`, top: `${Math.max(VIEWPORT_MARGIN, position().top)}px` }}
		>
			<For each={props.items}>
				{item => (
					<button
						type="button"
						role="menuitem"
						disabled={item.disabled}
						class="block w-full cursor-pointer px-3 py-1 text-left hover:bg-[var(--vscode-menu-selectionBackground,var(--vscode-list-activeSelectionBackground))] hover:text-[var(--vscode-menu-selectionForeground,var(--vscode-list-activeSelectionForeground))] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
						onClick={() => runItem(item)}
					>
						{item.label}
					</button>
				)}
			</For>
		</div>
	);
}
