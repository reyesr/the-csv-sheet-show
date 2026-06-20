import type { ExporterDescriptor } from '../../shared/messages/export';
import type { ExportColumn, ExportContext, TextExportEncoder } from '../types';

/**
 * HTML table exporter. Builds on the shared pipeline (architecture.md §3.5) and the per-format plan
 * in local/features/exports/html-table.md. Pure string building — no `vscode`/`fs` — so the webview
 * dev emulator can run it in-browser.
 *
 * HTML is the highest-fidelity styled export: it maps column alignment and foreground/background
 * colors directly to CSS. It does not normalize values — every cell is emitted verbatim as escaped
 * text — so it declares no type system (`typing: false`).
 */
export const HTML_DESCRIPTOR: ExporterDescriptor = {
	id: 'html',
	description: 'An HTML <table>: a bare fragment, a styled fragment, or a full document.',
	fileExtension: 'html',
	features: { typing: false, alignment: true, colors: true, parameters: true, clipboard: true },
	types: []
};

export type HtmlWrap = 'fragment' | 'styled-fragment' | 'document';
export type HtmlStyleMode = 'inline' | 'classes';
export type HtmlNewlineMode = 'pre-wrap' | 'br';

export interface HtmlOptions {
	wrap: HtmlWrap;
	includeHeaderRow: boolean;
	/** Resolved emission strategy: `fragment` forces `inline`; the others default to `classes`. */
	styleMode: HtmlStyleMode;
	tableClass: string;
	bordered: boolean;
	newline: HtmlNewlineMode;
}

const DEFAULT_TABLE_CLASS = 'csv-export';

/** Validate/default raw `formatOptions` into a normalized {@link HtmlOptions}. */
export function validateHtmlOptions(raw: Record<string, unknown>): HtmlOptions {
	const wrap = oneOf<HtmlWrap>(raw.wrap, ['fragment', 'styled-fragment', 'document'], 'styled-fragment');
	return {
		wrap,
		includeHeaderRow: raw.includeHeaderRow !== false,
		// `fragment` is a bare table with no <style> block, so it can only carry inline styles.
		styleMode: wrap === 'fragment' ? 'inline' : oneOf<HtmlStyleMode>(raw.styleMode, ['inline', 'classes'], 'classes'),
		tableClass: sanitizeClass(raw.tableClass),
		bordered: raw.bordered !== false,
		newline: oneOf<HtmlNewlineMode>(raw.newline, ['pre-wrap', 'br'], 'pre-wrap')
	};
}

export function createHtmlEncoder(): TextExportEncoder {
	return new HtmlEncoder();
}

/** A single CSS declaration as a `[property, value]` pair. */
type Declaration = [property: string, value: string];

class HtmlEncoder implements TextExportEncoder {
	private options: HtmlOptions = validateHtmlOptions({});
	/** Per-column resolved declarations (classes-mode class name + the rule body), indexed by export position. */
	private columnStyles: Array<{ className: string | null; declarations: Declaration[] }> = [];

	public begin(ctx: ExportContext): string {
		this.options = validateHtmlOptions(ctx.formatOptions);
		this.columnStyles = ctx.columns.map((column, position) => {
			const declarations = columnDeclarations(column);
			return { className: declarations.length > 0 ? `col-${position}` : null, declarations };
		});

		const lines: string[] = [];
		const styleBlock = this.options.styleMode === 'classes' ? this.buildStyleBlock() : null;

		if (this.options.wrap === 'document') {
			lines.push('<!DOCTYPE html>', '<html>', '<head>', '<meta charset="utf-8">', '<title>Exported data</title>');
			if (styleBlock !== null) {
				lines.push(...styleBlock);
			}
			lines.push('</head>', '<body>');
		} else if (styleBlock !== null) {
			lines.push(...styleBlock);
		}

		lines.push(this.tableTag());
		if (this.options.includeHeaderRow && ctx.hasHeader) {
			lines.push(this.headerRow(ctx.columns));
		}
		lines.push('<tbody>');
		return lines.join('\n') + '\n';
	}

	public encodeRow(cells: string[], _rowIndex: number, _ctx: ExportContext): string {
		let row = '<tr>';
		for (let i = 0; i < this.columnStyles.length; i++) {
			row += `<td${this.cellAttributes(i, cells[i] ?? '')}>${this.cellContent(cells[i] ?? '')}</td>`;
		}
		return row + '</tr>\n';
	}

	public end(_ctx: ExportContext): string {
		return this.options.wrap === 'document'
			? '</tbody>\n</table>\n</body>\n</html>\n'
			: '</tbody>\n</table>\n';
	}

	/** The `<style>` block (classes mode): base table rules + one rule per styled column. */
	private buildStyleBlock(): string[] {
		const table = `table.${this.options.tableClass}`;
		const cellBase: Declaration[] = [];
		if (this.options.bordered) {
			cellBase.push(['border', '1px solid #ccc']);
		}
		cellBase.push(['padding', '2px 6px']);
		if (this.options.newline === 'pre-wrap') {
			cellBase.push(['white-space', 'pre-wrap']);
		}

		const lines = [
			'<style>',
			`${table} { border-collapse: collapse; }`,
			`${table} th, ${table} td { ${formatBlock(cellBase)} }`
		];
		for (const style of this.columnStyles) {
			if (style.className !== null) {
				lines.push(`${table} .${style.className} { ${formatBlock(style.declarations)} }`);
			}
		}
		lines.push('</style>');
		return lines;
	}

	private tableTag(): string {
		return this.options.styleMode === 'classes'
			? `<table class="${this.options.tableClass}">`
			: '<table>';
	}

	private headerRow(columns: ExportColumn[]): string {
		let row = '<thead><tr>';
		for (let i = 0; i < columns.length; i++) {
			row += `<th scope="col"${this.cellAttributes(i, columns[i].name)}>${this.cellContent(columns[i].name)}</th>`;
		}
		return row + '</tr></thead>';
	}

	/** The `class="…"` (classes mode) or `style="…"` (inline mode) attribute for a cell, or ''. */
	private cellAttributes(position: number, value: string): string {
		if (this.options.styleMode === 'classes') {
			const className = this.columnStyles[position]?.className ?? null;
			return className !== null ? ` class="${className}"` : '';
		}

		const declarations = [...(this.columnStyles[position]?.declarations ?? [])];
		// Inline mode has no <style> block, so a multi-line cell carries its own wrapping rule.
		if (this.options.newline === 'pre-wrap' && value.includes('\n')) {
			declarations.push(['white-space', 'pre-wrap']);
		}
		return declarations.length > 0 ? ` style="${formatInline(declarations)}"` : '';
	}

	private cellContent(value: string): string {
		const escaped = escapeHtml(value);
		return this.options.newline === 'br' ? escaped.replace(/\r\n|\r|\n/g, '<br>') : escaped;
	}
}

/** The CSS declarations a column contributes from its retained styling (empty when it has none). */
function columnDeclarations(column: ExportColumn): Declaration[] {
	const declarations: Declaration[] = [];
	const align = column.align ?? 'left';
	if (align !== 'left') {
		declarations.push(['text-align', align]);
	}
	const fg = validColor(column.foregroundColor);
	if (fg !== null) {
		declarations.push(['color', fg]);
	}
	const bg = validColor(column.backgroundColor);
	if (bg !== null) {
		declarations.push(['background-color', bg]);
	}
	return declarations;
}

/** HTML text-content escaping (html-table.md §3.2): the three structural characters only. */
export function escapeHtml(value: string): string {
	let out = '';
	for (const char of value) {
		switch (char) {
			case '&': out += '&amp;'; break;
			case '<': out += '&lt;'; break;
			case '>': out += '&gt;'; break;
			default: out += char;
		}
	}
	return out;
}

/** A stored color is only emitted when it is a well-formed `#rrggbb` (defense per §3.2). */
function validColor(value: string | null | undefined): string | null {
	return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

/** Reduce a user-supplied table class to a safe CSS identifier, falling back to the default. */
function sanitizeClass(value: unknown): string {
	if (typeof value !== 'string') {
		return DEFAULT_TABLE_CLASS;
	}
	const cleaned = value.trim().replace(/[^A-Za-z0-9_-]/g, '');
	return cleaned.length > 0 ? cleaned : DEFAULT_TABLE_CLASS;
}

/** `<style>`-block form: `prop: value;` declarations, space-separated. */
function formatBlock(declarations: Declaration[]): string {
	return declarations.map(([property, value]) => `${property}: ${value};`).join(' ');
}

/** Inline `style="…"` form: compact `prop:value` declarations, semicolon-separated. */
function formatInline(declarations: Declaration[]): string {
	return declarations.map(([property, value]) => `${property}:${value}`).join(';');
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}
