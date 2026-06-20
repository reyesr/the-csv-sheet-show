import { createEffect, createSignal } from 'solid-js';

const MAX_HEIGHT_PX = 120;

export function FormulaBarTextarea(props: {
	value: string;
	expansionLocked: boolean;
	onFocus: () => void;
	onInput: (value: string) => void;
	onKeyDown: (event: KeyboardEvent) => void;
	onBlur: () => void;
}) {
	let textareaRef: HTMLTextAreaElement | undefined;
	const [isFocused, setIsFocused] = createSignal(false);

	function adjustHeight(): void {
		if (!textareaRef) return;
		if (props.expansionLocked && !isFocused()) {
			// Collapse back to the single-row CSS height while the lock keeps expansion suppressed.
			textareaRef.style.height = '';
			return;
		}
		textareaRef.style.height = 'auto';
		const borderHeight = textareaRef.offsetHeight - textareaRef.clientHeight;
		textareaRef.style.height = `${Math.min(textareaRef.scrollHeight + borderHeight, MAX_HEIGHT_PX)}px`;
	}

	createEffect(() => {
		props.value;
		props.expansionLocked;
		isFocused();
		adjustHeight();
	});

	return (
		<div class="relative min-h-[2rem] flex-1">
			<textarea
				ref={el => (textareaRef = el)}
				rows={1}
				class="edit-tint absolute z-100 pl-2 left-0 top-0 w-full min-h-[1.5rem] max-h-[7.5rem] resize-none overflow-y-auto rounded-sm border border-[var(--vscode-panel-border)] px-1 py-0.5 outline-none vscode-high-contrast:border-[var(--vscode-focusBorder)]"
				value={props.value}
				placeholder="Active cell content"
				onFocus={() => {
					setIsFocused(true);
					props.onFocus();
				}}
				onInput={event => props.onInput(event.currentTarget.value)}
				onKeyDown={props.onKeyDown}
				onBlur={() => {
					setIsFocused(false);
					props.onBlur();
				}}
			/>
		</div>
	);
}
