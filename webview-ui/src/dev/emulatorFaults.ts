import { CsvLoadErrorReason } from '../../../src/shared/messages/errors';

/**
 * Toggle set the dev simulator uses to inject extension-level failures, so the webview's error
 * handling (load errors, rejected edits, search errors, unavailable rows) can be exercised without a
 * real VS Code host. Each flag maps to a concrete failure point in the production extension — see the
 * descriptions in {@link FAULT_TOGGLES}.
 */
export interface EmulatorFaults {
	/** `loaded-ready` and Reload Fixture answer with an `error` instead of data (a failed CSV load). */
	loadError: boolean;
	/** Which reason the simulated load error carries (mirrors CsvMappingReaderError.reason). */
	loadErrorReason: CsvLoadErrorReason;
	/** `requestRows` / `requestPage` answer with a global `error` (WebviewMessageRouter.postUnknownError). */
	rowRequestError: boolean;
	/** Cell/row/header edits answer with `changeRejected` instead of `changeApplied`. */
	editError: boolean;
	/** `findRequest` answers with a `searchStatus` of `error` (search reader / invalid pattern failure). */
	findError: boolean;
	/** `setCsvConfig` answers with an `error` (applyConfigChange's re-index failure path). */
	configError: boolean;
	/** Filtered page requests answer with `rows-unavailable` (filter scan hasn't reached the page yet). */
	filterUnavailable: boolean;
	/** Save (dev) streams saveStarted → saveProgress ticks → saveComplete, mimicking a slow large-file save. */
	slowSave: boolean;
}

/** Boolean fault keys (everything except the load-error reason enum). */
export type BooleanFaultKey = Exclude<keyof EmulatorFaults, 'loadErrorReason'>;

export interface FaultToggle {
	key: BooleanFaultKey;
	label: string;
	description: string;
}

/** Ordered metadata that drives the dev fault panel's checkboxes. */
export const FAULT_TOGGLES: readonly FaultToggle[] = [
	{
		key: 'loadError',
		label: 'CSV load failure',
		description: 'loaded-ready and Reload Fixture answer with an error instead of data.'
	},
	{
		key: 'rowRequestError',
		label: 'Row/page request I/O error',
		description: 'requestRows / requestPage answer with a global load error.'
	},
	{
		key: 'editError',
		label: 'Edit write failure',
		description: 'Cell, row, and header edits are rejected (changeRejected).'
	},
	{
		key: 'findError',
		label: 'Search engine error',
		description: 'Find requests answer with a search error status.'
	},
	{
		key: 'configError',
		label: 'Re-index failure',
		description: 'Applying a CSV format change answers with an error.'
	},
	{
		key: 'filterUnavailable',
		label: 'Filtered rows unavailable',
		description: 'Filtered page requests answer with rows-unavailable.'
	},
	{
		key: 'slowSave',
		label: 'Slow save',
		description: 'Save (dev) streams progress over ~1.5s so the toolbar save bar can be seen.'
	}
];

export const LOAD_ERROR_REASONS: readonly { value: CsvLoadErrorReason; label: string }[] = [
	{ value: CsvLoadErrorReason.Unknown, label: 'Unknown' },
	{ value: CsvLoadErrorReason.SelectedLineEndingNotFound, label: 'Selected line ending not found' }
];

export function createDefaultFaults(): EmulatorFaults {
	return {
		loadError: false,
		loadErrorReason: CsvLoadErrorReason.Unknown,
		rowRequestError: false,
		editError: false,
		findError: false,
		configError: false,
		filterUnavailable: false,
		slowSave: false
	};
}

/** Count of active boolean faults, for the collapsed panel's summary badge. */
export function countActiveFaults(faults: EmulatorFaults): number {
	return FAULT_TOGGLES.reduce((total, toggle) => total + (faults[toggle.key] ? 1 : 0), 0);
}
