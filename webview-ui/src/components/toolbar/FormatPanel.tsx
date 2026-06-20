import { createEffect, createSignal } from 'solid-js';
import type { CsvGridController } from '../../types';
import { postMessage } from '../../vscode';
import { createRememberedSignal } from '../../remembered';
import { Button } from '../common/Button';
import { Select } from '../common/Select';
import { Field } from '../common/Field';
import { SetCsvConfigMessage } from '../../../../src/shared/messages/config';

const ENCODINGS = [
	'utf-8',
	'utf-16le',
	'utf-16be',
	'latin1',
	'ascii',
	'windows-1252',
	'iso-8859-2',
	'big5',
	'shift_jis',
	'utf-32',
] as const;

const SEPARATORS = [
	{ value: ',', label: 'Comma (,)' },
	{ value: ';', label: 'Semicolon (;)' },
	{ value: '\t', label: 'Tab' },
] as const;

const LINE_ENDINGS = [
	{ value: '\r\n', label: 'Windows (CRLF)' },
	{ value: '\n', label: 'Unix (LF)' },
	{ value: '\r', label: 'Old Mac (CR)' },
] as const;

const SAVING_OPTIONS = [
	{ value: 'remember', label: 'Remember for this file', description: 'This file will use this configuration' },
	{ value: 'generalize', label: 'Generalize for similar files', description: 'Files in this workspace with the same headers will use this configuration' },
	{ value: 'none', label: 'Do not remember', description: 'Do not remember this configuration for the next time' },
] as const;

const SAVING_OPTIONS_NO_HEADER = [
	{ value: 'remember', label: 'Remember for this file', description: 'This file will use this configuration' },
	{ value: 'none', label: 'Do not remember', description: 'Do not remember this configuration for the next time' },
] as const;

/**
 * Inline panel (§07) that docks below the command bar's Format control. It holds a draft of the
 * parsing config so the grid underneath stays visible; Apply re-parses the file, and "Remember
 * for similar files" persists the choice for files that look alike. No file name — VS Code's tab
 * already shows it (§08).
 */
export function FormatPanel(props: { grid: CsvGridController; onApplied?: () => void }) {
	const config = () => props.grid.csvConfig();
	const [separator, setSeparator] = createSignal<string>(',');
	const [encoding, setEncoding] = createSignal<string>('utf-8');
	const [lineEnding, setLineEnding] = createSignal<string>('\n');
	const [hasHeader, setHasHeader] = createSignal<boolean>(false);
	// Remembers the user's last save choice per file (extension-backed via createRememberedSignal).
	const configSavingOption = createRememberedSignal<'remember' | 'generalize' | 'none'>(
		'format.savingOption',
		{ scope: 'file', default: 'remember' }
	);

	// Seed the drafts from the active config whenever it changes (open, or after a re-parse).
	createEffect(() => {
		const current = config();
		if (current === null) {
			return;
		}

		setSeparator(current.separator);
		const encoding = current?.encoding === 'utf8' ? 'utf-8' : current?.encoding;
		setEncoding(encoding);
		setLineEnding(current.lineEnding);
		setHasHeader(current.hasHeader);
	});

	function apply(): void {
		if (config() === null) {
			return;
		}

		const savingOption: SetCsvConfigMessage['savingOption'] = configSavingOption.value();
		const message: SetCsvConfigMessage = {
			type: 'setCsvConfig',
			separator: separator(),
			encoding: encoding(),
			lineEnding: lineEnding(),
			hasHeader: hasHeader(),
			savingOption,
		};
		console.log('FormatPanel: sending setCsvConfig message', message);
		postMessage(message);

		// postMessage({
		// 	type: 'setCsvConfig',
		// 	separator: separator(),
		// 	encoding: encoding(),
		// 	lineEnding: lineEnding(),
		// 	hasHeader: hasHeader(),
		// 	savingOption,
		// });
		props.onApplied?.();
	}

	return (
		<section
			class="rounded-sm border border-border bg-selected p-3 text-control text-fg vscode-high-contrast:border-focus"
			aria-label="Format"
		>
			<div class="mb-3 text-sm text-fg-muted">
				The CSV parser usually detects the correct configuration automatically, but you can override it here.
			</div>
			<div class="flex flex-wrap items-end gap-3">
				<Field label="Separator" class="min-w-[112px]">
					{control => (
						<Select
							{...control}
							fullWidth
							options={SEPARATORS.map(separatorOption => ({ value: separatorOption.value, label: separatorOption.label }))}
							selectedValue={separator()}
							onSelect={value => setSeparator(String(value))}
						/>
					)}
				</Field>
				<Field label="Encoding" class="min-w-[112px]">
					{control => (
						<Select
							{...control}
							fullWidth
							options={ENCODINGS.map(encodingOption => ({ value: encodingOption, label: encodingOption }))}
							selectedValue={encoding()}
							onSelect={value => setEncoding(String(value))}
						/>
					)}
				</Field>
				<Field label="Line ending" class="min-w-[112px]">
					{control => (
						<Select
							{...control}
							fullWidth
							options={LINE_ENDINGS.map(lineEndingOption => ({ value: lineEndingOption.value, label: lineEndingOption.label }))}
							selectedValue={lineEnding()}
							onSelect={value => setLineEnding(String(value))}
						/>
					)}
				</Field>
				<label class="flex h-7 cursor-pointer items-center gap-2">
					<input
						type="checkbox"
						checked={hasHeader()}
						onChange={event => setHasHeader(event.currentTarget.checked)}
					/>
					<span>First row is header</span>
				</label>
			</div>

			<div class="mt-3 flex items-center gap-2 border-t border-border pt-3 vscode-high-contrast:border-focus">
				<Select
					fullWidth
					options={(hasHeader() ? SAVING_OPTIONS : SAVING_OPTIONS_NO_HEADER).map(option => ({ value: option.value, label: option.label, description: option.description }))}
					selectedValue={configSavingOption.value()}
					onSelect={value => configSavingOption.set(String(value) as 'remember' | 'generalize' | 'none')}
				/>
				<Button variant="primary" disabled={config() === null} onClick={() => apply()}>Apply</Button>

			</div>
		</section>
	);
}
