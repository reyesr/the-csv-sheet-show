import { For, Show, createMemo } from 'solid-js';
import type { FindMatchMessage } from '../../../../src/shared/messages/find';
import { splitHighlightedText } from './findUtils';

export function HighlightedText(props: {
	value: string;
	matches: FindMatchMessage[];
	isActiveMatch: (match: FindMatchMessage) => boolean;
}) {
	const parts = createMemo(() => splitHighlightedText(props.value, props.matches));

	return (
		<>
			<For each={parts()}>
				{part => (
					<Show when={part.match} fallback={part.text}>
						{match => (
							<mark class={props.isActiveMatch(match()) ? activeFindMatchClass : findMatchClass}>
								{part.text}
							</mark>
						)}
					</Show>
				)}
			</For>
		</>
	);
}

// Inline run highlights (§06): the active match gets the solid fill + match-border; every other
// match gets the translucent wash. Both keep the 1px corner radius.
const findMatchClass = 'rounded-[1px] bg-match-wash text-[var(--vscode-editor-foreground)]';
const activeFindMatchClass = 'rounded-[1px] bg-match text-[var(--vscode-editor-foreground)] outline outline-1 outline-[var(--vscode-editor-findMatchBorder,var(--vscode-focusBorder))]';
