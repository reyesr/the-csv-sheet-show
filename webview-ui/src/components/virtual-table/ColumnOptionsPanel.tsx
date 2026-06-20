import { createMemo, onCleanup, onMount, type JSX } from 'solid-js';
import { SegmentedToggle } from '../common/SegmentedToggle';
import { SimpleColorPicker } from '../common/SimpleColorPicker';
import { TextLink } from '../common/TextLink';
import type { ColumnDisplayOptions, ColumnOptionsPanelState, ColumnTextAlignment, ColumnTextStyle } from './types';

const PANEL_WIDTH = 288;
const PANEL_ESTIMATED_HEIGHT = 380;
const VIEWPORT_MARGIN = 8;

// I'm really having a hard time finding a good color palette that can work on both dark and light themes
// suggestions are welcome

// const FOREGROUND_COLOR_PALETTE = [
// 	'#b45309',
// 	'#ea580c',
// 	'#dc2626',
// 	'#db2777',
// 	'#7c3aed',
// 	'#2563eb',
// 	'#0d9488',
// 	'#a16207',
// 	'#65a30d',
// 	'#16a34a',
// 	'#0891b2',
// 	'#0284c7',
// 	'#eff6ff',
// 	'#eef2ff',
// 	'#f5f3ff',
// 	'#fff1f2',
// 	'#f8fafc'
// ];
// const BACKGROUND_COLOR_PALETTE = [
// 	'#fef3c7',
// 	'#ffedd5',
// 	'#fee2e2',
// 	'#fce7f3',
// 	'#ede9fe',
// 	'#dbeafe',
// 	'#ccfbf1',
// 	'#fef08a',
// 	'#bef264',
// 	'#86efac',
// 	'#67e8f9',
// 	'#38bdf8',
// 	'#2563eb',
// 	'#4f46e5',
// 	'#7c3aed',
// 	'#e11d48',
// 	'#475569'
// ];
// const FOREGROUND_COLOR_PALETTE = ["#1F4E79", "#2F75B5", "#548235", "#70AD47", "#C55A11", "#ED7D31", "#A64D79", "#7030A0", "#5B9BD5", "#00A2A5", "#7F6000", "#BF9000", "#C00000", "#E06666", "#666666", "#404040", "#000000"];
// const BACKGROUND_COLOR_PALETTE = ["#D9EAF7", "#BDD7EE", "#E2F0D9", "#C6E0B4", "#FCE4D6", "#F8CBAD", "#EADCF8", "#D9C2F0", "#DAEEF3", "#CCFFFF", "#FFF2CC", "#FFE699", "#F4CCCC", "#FCE4D6", "#E7E6E6", "#D9D9D9", "#FFFFFF"];

const FOREGROUND_COLOR_PALETTE = ["#FF9797", "#F9B7B7", "#EEC2AA", "#E3E88F", "#e7e7e7", "#c7F5c7", "#8EE375", "#2A9D69", "#4DDBC3", 
		"#40BBD8", "#337DD5", "#2A3BCE", "#4E27C1", "#7B25B3",  "#8C1D42", "#4C1D20", "#1D1D1D"];
const BACKGROUND_COLOR_PALETTE = [ "#422", "#751F1F", "#917227", "#989F2A", "#78AD2E", "#51BB32", "#36C948", "#44CD86", 
		"#52D1BC", "#60BFD5", "#6E9FD8", "#7C86DC", "#A08AE0", "#B65AE4", "#E5A6E7", "#FAD5d5", "#EFeeD1"];

const ALIGNMENTS: { value: ColumnTextAlignment; label: string }[] = [
	{ value: 'left', label: 'Left' },
	{ value: 'center', label: 'Center' },
	{ value: 'right', label: 'Right' }
] as const;

export function ColumnOptionsPanel(props: {
	state: ColumnOptionsPanelState;
	options: ColumnDisplayOptions;
	/** Header name for this column when the file has a real header; falls back to "Display options" when null. */
	headerLabel: string | null;
	onTextAlignChange: (columnIndex: number, textAlign: ColumnTextAlignment) => void;
	onTextStyleChange: (columnIndex: number, textStyle: ColumnTextStyle) => void;
	onForegroundColorChange: (columnIndex: number, color: string | null) => void;
	onBackgroundColorChange: (columnIndex: number, color: string | null) => void;
	onReset: (columnIndex: number) => void;
	onClose: () => void;
}) {
	let element: HTMLDivElement | undefined;
	const textStyles: { value: ColumnTextStyle; label: JSX.Element; title: string }[] = [
		{ value: 'normal', label: 'Normal', title: 'Normal' },
		{ value: 'bold', label: <span class="font-bold">B</span>, title: 'Bold' },
		{ value: 'underline', label: <span class="underline">U</span>, title: 'Underline' },
		{ value: 'strike-through', label: <span class="line-through">S</span>, title: 'Strike-through' }
	];
	const defaultForegroundColor = () => getThemeColor('--vscode-foreground', '#cccccc');
	const defaultBackgroundColor = () => getThemeColor('--vscode-editor-background', '#ffffff');
	const position = createMemo(() => ({
		left: clamp(props.state.anchorRect.right - PANEL_WIDTH, VIEWPORT_MARGIN, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN),
		top: clamp(props.state.anchorRect.bottom + 4, VIEWPORT_MARGIN, window.innerHeight - PANEL_ESTIMATED_HEIGHT - VIEWPORT_MARGIN)
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

	return (
		<div
			ref={element}
			role="dialog"
			aria-label={`Column ${props.state.columnIndex + 1} display options`}
			class="fixed z-50 w-72 rounded-sm border border-border bg-widget p-3 text-control text-fg shadow-elevated vscode-high-contrast:border-focus"
			style={{ left: `${position().left}px`, top: `${position().top}px` }}
		>
			<div class="mb-3 flex items-center justify-between gap-3 border-b border-border pb-2 vscode-high-contrast:border-focus">
				<div class="min-w-0">
					<div class="font-medium">Column {props.state.columnIndex + 1}</div>
					<div class="truncate text-label text-fg-muted" title={props.headerLabel ?? undefined}>
						{props.headerLabel ?? 'Display options'}
					</div>
				</div>
			</div>

			<div class="space-y-3">
				<div>
					<div class="mb-1.5 text-label font-medium uppercase tracking-wide text-fg-muted">Alignment</div>
					<SegmentedToggle
						aria-label="Horizontal text alignment"
						options={ALIGNMENTS}
						value={props.options.textAlign}
						onChange={textAlign => props.onTextAlignChange(props.state.columnIndex, textAlign)}
					/>
				</div>

				<div>
					<div class="mb-1.5 text-label font-medium uppercase tracking-wide text-fg-muted">Style</div>
					<SegmentedToggle
						aria-label="Text style"
						options={textStyles}
						value={props.options.textStyle}
						onChange={textStyle => props.onTextStyleChange(props.state.columnIndex, textStyle)}
					/>
				</div>

				<SimpleColorPicker
					label="Text color"
					color={props.options.foregroundColor ?? defaultForegroundColor()}
					palette={FOREGROUND_COLOR_PALETTE}
					onChange={color => props.onForegroundColorChange(props.state.columnIndex, color)}
				/>

				<SimpleColorPicker
					label="Background"
					color={props.options.backgroundColor ?? defaultBackgroundColor()}
					palette={BACKGROUND_COLOR_PALETTE}
					onChange={color => props.onBackgroundColorChange(props.state.columnIndex, color)}
				/>

				<div class="flex flex-wrap justify-end gap-2 border-t border-border pt-2 vscode-high-contrast:border-focus">
					<TextLink onClick={() => props.onReset(props.state.columnIndex)}>Reset all</TextLink>
					<TextLink onClick={() => {
						props.onBackgroundColorChange(props.state.columnIndex, null);
						props.onForegroundColorChange(props.state.columnIndex, null);
					}}>Reset colors</TextLink>
				</div>
			</div>
		</div>
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

function getThemeColor(variableName: string, fallback: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim() || fallback;
}
