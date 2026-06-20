import { createEffect, createMemo, Show } from 'solid-js';
import { cn } from '../../cn';
import { IconButton } from '../common/IconButton';
import { MultiSelect, type MultiSelectValue } from '../common/MultiSelect';
import { SegmentedToggle } from '../common/SegmentedToggle';
import { CaretIcon, CloseIcon } from '../common/icons';
import type { FindController } from '../../types';

type FindMode = 'navigate' | 'filter';

const FIND_MODES = [
	{ value: 'navigate' as const, label: 'Navigate' },
	{ value: 'filter' as const, label: 'Filter' }
];

export function FindBar(props: { find: FindController; headerCells: string[]; columnCount: number }) {
	let findInput: HTMLInputElement | undefined;
	const columnOptions = createMemo(() => Array.from({ length: props.columnCount }, (_, columnIndex) => {
		const header = props.headerCells[columnIndex]?.trim();
		return {
			value: columnIndex,
			label: header !== undefined && header.length > 0 ? header : `#${columnIndex + 1}`,
			description: `Column ${columnIndex + 1}`
		};
	}));
	const columnSummary = createMemo(() => {
		const selectedCount = props.find.selectedFindColumns().length;
		return selectedCount === 0 ? 'All columns' : `${selectedCount} column${selectedCount === 1 ? '' : 's'}`;
	});

	const mode = (): FindMode => (props.find.filterMode() ? 'filter' : 'navigate');

	function setMode(next: FindMode): void {
		if ((next === 'filter') !== props.find.filterMode()) {
			props.find.toggleFilterMode();
		}
	}

	// Scope the search to every column in a single re-search (instead of one toggle per column).
	function selectAllColumns(): void {
		const allColumns = columnOptions().map(option => Number(option.value));
		props.find.startFind(
			props.find.findQuery(),
			props.find.findMatchCase(),
			props.find.findWholeWord(),
			props.find.findRegex(),
			allColumns
		);
	}

	// Re-run the search with the updated option flag, mirroring the previous checkbox behaviour.
	function toggleOption(setter: (value: boolean) => void, current: boolean, kind: 'case' | 'word' | 'regex'): void {
		const next = !current;
		setter(next);
		props.find.startFind(
			props.find.findQuery(),
			kind === 'case' ? next : props.find.findMatchCase(),
			kind === 'word' ? next : props.find.findWholeWord(),
			kind === 'regex' ? next : props.find.findRegex()
		);
	}

	createEffect(() => {
		props.find.findFocusRequest();
		queueMicrotask(() => {
			findInput?.focus();
			findInput?.select();
		});
	});

	return (
		<section
			role="search"
			class="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-widget px-3 py-2 text-control shadow-elevated vscode-high-contrast:border-focus"
		>
			<SegmentedToggle aria-label="Find mode" options={FIND_MODES} value={mode()} onChange={setMode} />

			<input
				ref={element => { findInput = element; }}
				class="h-7 w-64 rounded-sm border border-input-border bg-input px-2 text-input-fg vscode-high-contrast:border-focus"
				placeholder="Find in CSV"
				value={props.find.findQuery()}
				onInput={event => props.find.startFind(event.currentTarget.value)}
				onKeyDown={event => {
					if (event.key === 'Enter') {
						event.preventDefault();
						props.find.navigateFindMatch(event.shiftKey ? -1 : 1);
					}

					if (event.key === 'Escape') {
						event.preventDefault();
						props.find.closeFindBar();
					}
				}}
			/>

			<Show when={mode() === 'navigate'}>
				<div class="flex items-center gap-1">
					<IconButton
						icon={<CaretIcon class="h-3.5 w-3.5 rotate-180 cursor-pointer" />}
						title="Previous match"
						onClick={() => props.find.navigateFindMatch(-1)}
					/>
					<IconButton
						icon={<CaretIcon class="h-3.5 w-3.5 cursor-pointer" />}
						title="Next match"
						onClick={() => props.find.navigateFindMatch(1)}
					/>
				</div>
			</Show>

			<span class="min-w-16 font-mono text-label text-fg-muted" role="status" aria-live="polite">
				{props.find.findStatus()}
			</span>

			<div class="flex items-center gap-1">
				<OptionChip label="Aa" title="Match case" pressed={props.find.findMatchCase()} onToggle={() => toggleOption(props.find.setFindMatchCase, props.find.findMatchCase(), 'case')} />
				<OptionChip label="W" title="Whole word" pressed={props.find.findWholeWord()} onToggle={() => toggleOption(props.find.setFindWholeWord, props.find.findWholeWord(), 'word')} />
				<OptionChip label=".*" title="Regular expression" pressed={props.find.findRegex()} onToggle={() => toggleOption(props.find.setFindRegex, props.find.findRegex(), 'regex')} />
			</div>

			<MultiSelect
				label="Search in columns"
				options={columnOptions()}
				selectedValues={props.find.selectedFindColumns()}
				summary={columnSummary()}
				onToggle={(value: MultiSelectValue) => props.find.toggleFindColumn(Number(value))}
				onClear={props.find.clearFindColumns}
				onSelectAll={selectAllColumns}
			/>

			<IconButton icon={<CloseIcon class="h-3.5 w-3.5" />} title="Close find" onClick={props.find.closeFindBar} />
		</section>
	);
}

/** A small monospace toggle chip (Aa / W / .*) in the find bar's option group (§07). */
function OptionChip(props: { label: string; title: string; pressed: boolean; onToggle: () => void }) {
	return (
		<button
			type="button"
			class={cn(
				'inline-flex h-7 min-w-7 items-center justify-center rounded-sm border px-2 font-mono text-label vscode-high-contrast:border-focus cursor-pointer',
				props.pressed
					? 'border-transparent bg-primary text-primary-fg'
					: 'border-border bg-secondary text-fg-muted hover:bg-secondary-hover hover:text-fg'
			)}
			aria-pressed={props.pressed}
			title={props.title}
			onMouseDown={event => event.preventDefault()}
			onClick={props.onToggle}
		>
			{props.label}
		</button>
	);
}
