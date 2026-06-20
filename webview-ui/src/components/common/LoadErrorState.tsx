import { CsvLoadErrorReason } from '../../../../src/shared/messages/errors';

interface LoadErrorCopy {
	title: string;
	detail: string;
}

export function LoadErrorState(props: { reason: CsvLoadErrorReason }) {
	const copy = () => getLoadErrorCopy(props.reason);

	return (
		<div class="flex h-full min-h-64 items-center justify-center px-5 py-8 text-center text-[var(--vscode-foreground)]">
			<div class="max-w-xl rounded-md border border-error-border bg-widget px-7 py-6 shadow-elevated vscode-high-contrast:border-focus">
				<SorryIcon />
				<h2 class="mt-4 text-lg font-semibold text-[var(--vscode-errorForeground)]">{copy().title}</h2>
				<p class="mt-2 text-sm leading-6 text-fg-muted">{copy().detail}</p>
			</div>
		</div>
	);
}

function getLoadErrorCopy(reason: CsvLoadErrorReason): LoadErrorCopy {
	switch (reason) {
		case CsvLoadErrorReason.SelectedLineEndingNotFound:
			return {
				title: 'Couldn’t open this file',
				detail: 'The selected line ending wasn’t found in the first 1 MiB. Try changing the line ending in Format.'
			};
		case CsvLoadErrorReason.Unknown:
		default:
			return {
				title: 'Couldn’t open this file',
				detail: 'Something went wrong while reading the file. The encoding may be wrong — try changing it in Format.'
			};
	}
}

function SorryIcon() {
	return (
		<svg class="mx-auto h-28 w-28 text-[var(--vscode-errorForeground)]" viewBox="0 0 128 128" role="img" aria-label="Sorry">
			<circle cx="64" cy="70" r="34" fill="currentColor" opacity="0.18" />
			<circle cx="64" cy="70" r="29" fill="var(--vscode-editor-background)" stroke="currentColor" stroke-width="4" />
			<path d="M47 61c4-5 10-5 14 0" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="4" />
			<path d="M67 61c4-5 10-5 14 0" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="4" />
			<path d="M52 83c7-6 17-6 24 0" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="4" />
			<path d="M88 27h22a9 9 0 0 1 9 9v14a9 9 0 0 1-9 9h-7l-8 9v-9h-7a9 9 0 0 1-9-9V36a9 9 0 0 1 9-9Z" fill="var(--vscode-editorWidget-background,var(--vscode-sideBar-background))" stroke="currentColor" stroke-width="3" />
			<text x="99" y="47" text-anchor="middle" font-size="13" font-weight="700" fill="currentColor">Sorry</text>
			<path d="M37 42c5-14 20-22 35-18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="4" opacity="0.55" />
		</svg>
	);
}
