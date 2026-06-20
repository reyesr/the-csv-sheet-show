import type { ExporterDescriptor } from '../../shared/messages/export';
import type { ExportColumn, ExportContext, FormattedField, TextExportEncoder } from '../types';

/**
 * JSON exporter. Builds on the shared pipeline (architecture.md §3.5) and the per-format plan in
 * local/features/exports/json.md. Pure string building — no `vscode`/`fs` — so the webview dev
 * emulator can run it in-browser.
 *
 * JSON is a data format: it ignores alignment/colors but supports per-column typing with the type
 * system `text` / `number`.
 */
export const JSON_DESCRIPTOR: ExporterDescriptor = {
	id: 'json',
	description: 'Array of objects, array of arrays, or newline-delimited JSON.',
	fileExtension: 'json',
	features: { typing: true, alignment: false, colors: false, parameters: true, clipboard: true },
	types: [
		{ id: 'text', label: 'Text', kind: 'text' },
		{ id: 'number', label: 'Number', kind: 'numeric' }
	]
};

export type JsonShape = 'objects' | 'arrays' | 'ndjson';
export type JsonEmptyAs = 'null' | 'empty-string' | 'omit';
export type JsonKeyStyle = 'header' | 'as-is' | 'camelCase' | 'snake_case';

export interface JsonOptions {
	shape: JsonShape;
	/** Indentation unit: '' = minified (single line), or two/four spaces or a tab. */
	indentUnit: string;
	emptyAs: JsonEmptyAs;
	includeHeaderRow: boolean;
	keyStyle: JsonKeyStyle;
}

/** Validate/default raw `formatOptions` into a normalized {@link JsonOptions}. */
export function validateJsonOptions(raw: Record<string, unknown>): JsonOptions {
	return {
		shape: oneOf(raw.shape, ['objects', 'arrays', 'ndjson'], 'objects'),
		indentUnit: indentUnitFrom(raw.indent),
		emptyAs: oneOf(raw.emptyAs, ['null', 'empty-string', 'omit'], 'null'),
		includeHeaderRow: raw.includeHeaderRow === true,
		keyStyle: oneOf(raw.keyStyle, ['header', 'as-is', 'camelCase', 'snake_case'], 'header')
	};
}

export function createJsonEncoder(): TextExportEncoder {
	return new JsonEncoder();
}

const MAX_SAFE_INTEGER_DIGITS = 15;

class JsonEncoder implements TextExportEncoder {
	private firstWritten = false;
	private options: JsonOptions = validateJsonOptions({});
	private keys: string[] = [];

	public begin(ctx: ExportContext): string {
		this.firstWritten = false;
		this.options = validateJsonOptions(ctx.formatOptions);
		this.keys = deriveKeys(ctx.columns, this.options.keyStyle);

		if (this.options.shape === 'ndjson') {
			return '';
		}

		let out = '[';
		if (this.options.shape === 'arrays' && this.options.includeHeaderRow) {
			out += this.element(this.arrayLiteral(this.keys.map(jsonString)));
		}
		return out;
	}

	public encodeRow(cells: string[], _rowIndex: number, ctx: ExportContext): string {
		if (this.options.shape === 'arrays') {
			const values = ctx.columns.map((_, i) => this.valueForArray(ctx.formatField(cells[i] ?? '', i), ctx.columns[i]));
			return this.element(this.arrayLiteral(values));
		}

		// objects / ndjson: build `{ key: value }`, applying emptyAs: 'omit'.
		const pairs: string[] = [];
		for (let i = 0; i < ctx.columns.length; i++) {
			const field = ctx.formatField(cells[i] ?? '', i);
			if (field.empty && this.options.emptyAs === 'omit') {
				continue;
			}
			pairs.push(`${jsonString(this.keys[i])}${this.colon()}${this.valueForObject(field, ctx.columns[i])}`);
		}
		const object = this.objectLiteral(pairs);

		if (this.options.shape === 'ndjson') {
			return `${this.compactObject(pairs)}\n`;
		}
		return this.element(object);
	}

	public end(_ctx: ExportContext): string {
		if (this.options.shape === 'ndjson') {
			return '';
		}
		const pretty = this.options.indentUnit !== '';
		return `${this.firstWritten && pretty ? '\n' : ''}]\n`;
	}

	/** Wrap an element with the correct inter-element separator and per-line indent. */
	private element(text: string): string {
		const pretty = this.options.indentUnit !== '';
		const prefix = this.firstWritten ? ',' : '';
		this.firstWritten = true;
		return pretty ? `${prefix}\n${this.options.indentUnit}${text}` : `${prefix}${text}`;
	}

	private colon(): string {
		return this.options.indentUnit !== '' ? ': ' : ':';
	}

	private objectLiteral(pairs: string[]): string {
		if (pairs.length === 0) {
			return '{}';
		}
		return this.options.indentUnit !== '' ? `{ ${pairs.join(', ')} }` : `{${pairs.join(',')}}`;
	}

	/** ndjson objects are always compact (one document per line). */
	private compactObject(pairs: string[]): string {
		return `{${pairs.join(',')}}`;
	}

	private arrayLiteral(values: string[]): string {
		return this.options.indentUnit !== '' ? `[${values.join(', ')}]` : `[${values.join(',')}]`;
	}

	private valueForObject(field: FormattedField, column: ExportColumn): string {
		if (field.empty) {
			if (this.options.emptyAs === 'empty-string') {
				return '""';
			}
			return 'null'; // 'omit' is handled by the caller (key skipped); 'null' is the default
		}
		return this.scalar(field, column);
	}

	private valueForArray(field: FormattedField, column: ExportColumn): string {
		if (field.empty) {
			// 'omit' is meaningless inside an array → fall back to null.
			return this.options.emptyAs === 'empty-string' ? '""' : 'null';
		}
		return this.scalar(field, column);
	}

	private scalar(field: FormattedField, column: ExportColumn): string {
		if (column.kind === 'numeric' && field.coerced !== undefined) {
			return numericLiteral(field.coerced, field.raw);
		}
		return jsonString(field.raw);
	}
}

/** Derive object keys from column names: synthesize `column_N`, apply key style, de-duplicate. */
function deriveKeys(columns: ExportColumn[], keyStyle: JsonKeyStyle): string[] {
	const used = new Map<string, number>();
	return columns.map(column => {
		const fallback = `column_${column.sourceIndex + 1}`;
		const styled = applyKeyStyle(column.name.trim().length > 0 ? column.name : fallback, keyStyle);
		const base = styled.length > 0 ? styled : fallback;
		const count = used.get(base) ?? 0;
		used.set(base, count + 1);
		return count === 0 ? base : `${base}_${count + 1}`;
	});
}

function applyKeyStyle(name: string, keyStyle: JsonKeyStyle): string {
	if (keyStyle === 'header' || keyStyle === 'as-is') {
		return name;
	}
	const words = name.split(/[^A-Za-z0-9]+/).filter(word => word.length > 0);
	if (keyStyle === 'snake_case') {
		return words.map(word => word.toLowerCase()).join('_');
	}
	// camelCase
	return words
		.map((word, index) => index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join('');
}

/**
 * Render a coerced numeric string as a JSON number literal, falling back to a JSON string when the
 * value would lose precision (long integers) — preserving exactness over silent corruption.
 */
function numericLiteral(coerced: string, raw: string): string {
	const integerDigits = /^-?(\d+)$/.exec(coerced);
	if (integerDigits !== null && integerDigits[1].length > MAX_SAFE_INTEGER_DIGITS) {
		return jsonString(raw.trim());
	}

	const value = Number(coerced);
	if (!Number.isFinite(value)) {
		return jsonString(raw);
	}

	// Keep the user's own digits when `coerced` is already a valid JSON number token; otherwise
	// canonicalize (e.g. '.5' → '0.5', '01' → '1', '5.' → '5').
	if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(coerced)) {
		return coerced;
	}
	return String(value);
}

/** JSON string escaping per json.md §3.3 (non-ASCII printable characters are emitted verbatim). */
export function jsonString(value: string): string {
	let out = '"';
	for (const char of value) {
		const code = char.codePointAt(0)!;
		switch (char) {
			case '"': out += '\\"'; break;
			case '\\': out += '\\\\'; break;
			case '\n': out += '\\n'; break;
			case '\r': out += '\\r'; break;
			case '\t': out += '\\t'; break;
			case '\b': out += '\\b'; break;
			case '\f': out += '\\f'; break;
			default:
				out += code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : char;
		}
	}
	return out + '"';
}

function indentUnitFrom(indent: unknown): string {
	if (indent === '\t') {
		return '\t';
	}
	if (indent === 4) {
		return '    ';
	}
	if (indent === 2) {
		return '  ';
	}
	return ''; // 0 / unknown → minified
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}
