export enum CsvLoadErrorReason {
	SelectedLineEndingNotFound = 'selectedLineEndingNotFound',
	Unknown = 'unknown'
}

export interface ErrorMessage {
	type: 'error';
	reason: CsvLoadErrorReason;
}
