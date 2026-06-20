import { createSignal } from 'solid-js';
import { createRememberedSignal } from '../../remembered';
import type {
	ColumnDisplayOptions,
	ColumnDisplayOptionsMap,
	ColumnOptionsAnchorRect,
	ColumnOptionsPanelState,
	ColumnTextAlignment,
	ColumnTextStyle
} from './types';

const DEFAULT_COLUMN_OPTIONS: ColumnDisplayOptions = {
	textAlign: 'left',
	textStyle: 'normal',
	foregroundColor: null,
	backgroundColor: null
};

export function createColumnOptionsController() {
	// Per-column alignment/colors persist per file: each change is remembered immediately (extension-backed
	// via createRememberedSignal) and reloaded the next time the file opens.
	const storedOptions = createRememberedSignal<ColumnDisplayOptionsMap>('grid.columnOptions', { scope: 'file', default: {} });
	const [panelState, setPanelState] = createSignal<ColumnOptionsPanelState | null>(null);

	function getColumnOptions(columnIndex: number): ColumnDisplayOptions {
		// Spread over the defaults so options persisted before a field existed (e.g. textStyle)
		// are backfilled rather than read back as undefined.
		return { ...DEFAULT_COLUMN_OPTIONS, ...storedOptions.value()[columnIndex] };
	}

	function setColumnTextAlign(columnIndex: number, textAlign: ColumnTextAlignment): void {
		setColumnOptions(columnIndex, { textAlign });
	}

	function setColumnTextStyle(columnIndex: number, textStyle: ColumnTextStyle): void {
		setColumnOptions(columnIndex, { textStyle });
	}

	function setColumnForegroundColor(columnIndex: number, foregroundColor: string | null): void {
		setColumnOptions(columnIndex, { foregroundColor });
	}

	function setColumnBackgroundColor(columnIndex: number, backgroundColor: string | null): void {
		setColumnOptions(columnIndex, { backgroundColor });
	}

	function resetColumnOptions(columnIndex: number): void {
		const current = storedOptions.value();
		if (current[columnIndex] === undefined) {
			return;
		}

		const next = { ...current };
		delete next[columnIndex];
		storedOptions.set(next);
	}

	function openColumnOptions(columnIndex: number, anchorRect: ColumnOptionsAnchorRect): void {
		setPanelState({ columnIndex, anchorRect });
	}

	function closeColumnOptions(): void {
		setPanelState(null);
	}

	function setColumnOptions(columnIndex: number, patch: Partial<ColumnDisplayOptions>): void {
		const current = storedOptions.value();
		const nextOptions = { ...DEFAULT_COLUMN_OPTIONS, ...current[columnIndex], ...patch };
		const next = { ...current };

		if (isDefaultOptions(nextOptions)) {
			if (current[columnIndex] === undefined) {
				return; // nothing stored for this column — avoid a redundant write
			}
			delete next[columnIndex];
		} else {
			next[columnIndex] = nextOptions;
		}

		storedOptions.set(next);
	}

	return {
		panelState,
		getColumnOptions,
		setColumnTextAlign,
		setColumnTextStyle,
		setColumnForegroundColor,
		setColumnBackgroundColor,
		resetColumnOptions,
		openColumnOptions,
		closeColumnOptions
	};
}

function isDefaultOptions(options: ColumnDisplayOptions): boolean {
	return options.textAlign === DEFAULT_COLUMN_OPTIONS.textAlign
		&& options.textStyle === DEFAULT_COLUMN_OPTIONS.textStyle
		&& options.foregroundColor === DEFAULT_COLUMN_OPTIONS.foregroundColor
		&& options.backgroundColor === DEFAULT_COLUMN_OPTIONS.backgroundColor;
}
