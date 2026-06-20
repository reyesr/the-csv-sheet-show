export interface CsvFileConfigMessage {
	separator: string;
	encoding: string;
	lineEnding: string;
	decimalSeparator: number;
	hasHeader: boolean;
}

export interface SetCsvConfigMessage {
	type: 'setCsvConfig';
	separator: string;
	encoding: string;
	lineEnding: string;
	hasHeader: boolean;
	/**
	 * How to persist this configuration:
	 * - `remember`: for this file only (keyed by URI).
	 * - `generalize`: for every workspace file with the exact same headers (falls back to `remember`
	 *   when the file has no header row).
	 * - `none`: do not persist.
	 */
	savingOption?: 'remember' | 'generalize' | 'none';
}
