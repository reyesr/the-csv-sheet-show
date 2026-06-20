import type { Memento, Uri } from 'vscode';
import type { CsvFileConfig } from './CsvFileConfig';

const FILE_KEY_PREFIX = 'csv-config:file:';
const HEADERS_KEY_PREFIX = 'csv-config:headers:';

/**
 * Persists CSV parsing configs in a workspace `Memento` under two namespaces:
 * - by file URI ("remember" — this file only), and
 * - by the raw header-row string ("generalize" — every workspace file whose first line matches).
 *
 * Only the type of `Memento`/`Uri` is imported, so this stays decoupled from the VS Code runtime and
 * is easy to unit-test with a fake `Memento`.
 */
export class CsvConfigStore {
	public constructor(private readonly memento: Memento) { }

	public getForFile(uri: Uri): CsvFileConfig | undefined {
		return this.memento.get<CsvFileConfig>(fileKey(uri));
	}

	public getForHeaders(headerRow: string): CsvFileConfig | undefined {
		return this.memento.get<CsvFileConfig>(headersKey(headerRow));
	}

	public saveForFile(uri: Uri, config: CsvFileConfig): Thenable<void> {
		return this.memento.update(fileKey(uri), config);
	}

	public saveForHeaders(headerRow: string, config: CsvFileConfig): Thenable<void> {
		return this.memento.update(headersKey(headerRow), config);
	}
}

/**
 * Derive the "generalize" lookup key from a file's first chunk: the bytes up to the first CR/LF,
 * decoded as latin1 (lossless, and the file encoding isn't known yet at this point). Returns
 * `undefined` when the chunk contains no line ending, so the header row can't be bounded. Used by
 * both the load-time lookup and the save path, so the key is byte-for-byte identical on both.
 */
export function extractHeaderRowKey(buffer: Buffer): string | undefined {
	for (let i = 0; i < buffer.length; i++) {
		if (buffer[i] === 0x0a || buffer[i] === 0x0d) {
			return buffer.subarray(0, i).toString('latin1');
		}
	}

	return undefined;
}

function fileKey(uri: Uri): string {
	return `${FILE_KEY_PREFIX}${uri.toString()}`;
}

function headersKey(headerRow: string): string {
	return `${HEADERS_KEY_PREFIX}${headerRow}`;
}
