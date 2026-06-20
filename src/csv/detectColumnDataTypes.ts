/**
 * Column datatype detection for CSV.
 *
 * Scope
 * -----
 * `detectColumnDataTypes(rows, separator, options?)` infers, for each column of a CSV, whether
 * it holds TEXT, INTEGER, or DECIMAL values, and — for numeric columns — the most probable
 * number-formatting locale (e.g. `de-DE` vs `en-US`). It samples the first `maxRows` rows
 * (default 5000), optionally skipping a header row. It only classifies; it does not parse or
 * convert cell values. Numbers are recognised across 20 common locales whose separators and
 * digits are described by a small hardcoded table (no `Intl.NumberFormat`/ICU dependency).
 *
 * Algorithm
 * ---------
 * 1. Split the sampled rows into cells (reusing `splitCells`); the column count is the widest
 *    row, and missing trailing cells are treated as empty.
 * 2. The 20 locales collapse into 5 number-format "signatures" (digit set + grouping separator
 *    + decimal separator + standard/Indian grouping). For each signature, one regex matches a
 *    DECIMAL (must contain a decimal separator) and one matches a grouped INTEGER. A plain,
 *    separator-free integer is locale-neutral and counts as numeric under every signature.
 * 3. Per column, accumulate stats and keep the signatures under which *every* non-empty cell is
 *    numeric (its locale candidates). A single non-numeric cell makes the column TEXT.
 * 4. Resolve a document-wide locale by intersecting the candidate locales of all locale-
 *    constraining columns, then breaking ties via the OS locale (exact match → same language →
 *    a fixed priority order). Columns that cannot share a locale fall back per column.
 * 5. Emit each column's type: TEXT, plain INTEGER (no locale), or — using the resolved locale —
 *    DECIMAL or grouped INTEGER carrying that locale. This is what disambiguates values like
 *    "1.234" (DECIMAL under en-US, but grouped INTEGER 1234 under de-DE).
 *
 * Output
 * ------
 * An array of `ColumnDataType` (`{ type, locale? }`), one per column in column order. `locale`
 * is a BCP-47 tag present only when a locale was actually inferred (DECIMAL columns and
 * grouping-bearing INTEGER columns). The default for any column is `{ type: TEXT }`.
 */
import { splitCells } from './splitCells';

/** Datatype inferred for a whole column. Default for any column is TEXT. */
export enum ColumnType {
	TEXT,
	INTEGER,
	DECIMAL
}

export interface ColumnDataType {
	type: ColumnType;
	/**
	 * BCP-47 locale tag describing the number formatting of the column. Set for DECIMAL
	 * columns and for INTEGER columns that use grouping separators (where the locale was
	 * actually inferred). Absent for TEXT columns and plain (separator-free) integers.
	 */
	locale?: string;
}

export interface DetectColumnDataTypesOptions {
	/** When true, the first row is treated as a header and excluded from the statistics. */
	hasHeader?: boolean;
	/** Maximum number of data rows to sample. Defaults to 5000. */
	maxRows?: number;
	/**
	 * Operating-system locale used to break ties between equally-likely locale candidates.
	 * Defaults to the runtime locale reported by Intl (falling back to 'en-US').
	 */
	osLocale?: string;
}

const DEFAULT_MAX_ROWS = 5000;

/**
 * A distinct number-formatting "shape". The 20 supported locales collapse into a handful of
 * these, so we build/test one regex pair per signature and then expand a matched signature
 * to all of its member locales for counting and candidate selection.
 *
 * Separators are CLDR-derived. Because the table is hand-maintained (no Intl.NumberFormat),
 * it can drift from CLDR over time; update the members/separators here if that happens.
 */
interface NumberSignature {
	readonly locales: readonly string[];
	/** Regex character-class body for the digits (e.g. '0-9'). */
	readonly digit: string;
	/** Regex fragment matching a single grouping separator (may itself be a character class). */
	readonly group: string;
	/** Regex fragment matching the decimal separator. */
	readonly decimal: string;
	readonly grouping: 'standard' | 'indian';
}

// Lenient class of space characters used as a grouping separator: regular space, NBSP,
// narrow NBSP (modern CLDR for fr/ru), and thin space. Real-world files mix these.
const GROUP_SPACES = '[\\u0020\\u00A0\\u202F\\u2009]';

const SIGNATURES: readonly NumberSignature[] = [
	{ // S1: dot decimal, comma grouping (Western)
		locales: ['en-US', 'en-GB', 'en-CA', 'zh-CN', 'zh-TW', 'zh-HK', 'es-MX', 'es-419', 'ja-JP', 'ko-KR'],
		digit: '0-9',
		group: ',',
		decimal: '\\.',
		grouping: 'standard'
	},
	{ // S2: comma decimal, dot grouping (continental European)
		locales: ['es-ES', 'de-DE', 'it-IT', 'pt-BR'],
		digit: '0-9',
		group: '\\.',
		decimal: ',',
		grouping: 'standard'
	},
	{ // S3: comma decimal, space grouping
		locales: ['fr-FR', 'ru-RU', 'pt-PT'],
		digit: '0-9',
		group: GROUP_SPACES,
		decimal: ',',
		grouping: 'standard'
	},
	{ // S4: dot decimal, comma grouping with Indian 3-2-2 grouping
		locales: ['en-IN', 'hi-IN'],
		digit: '0-9',
		group: ',',
		decimal: '\\.',
		grouping: 'indian'
	},
	{ // S5: Arabic decimal/grouping separators and Arabic-Indic digits
		locales: ['ar-SA'],
		digit: '\\u0660-\\u0669',
		group: '\\u066C',
		decimal: '\\u066B',
		grouping: 'standard'
	}
];

interface CompiledSignature {
	readonly locales: readonly string[];
	readonly decimalRegex: RegExp;
	readonly groupedIntegerRegex: RegExp;
}

const COMPILED_SIGNATURES: readonly CompiledSignature[] = SIGNATURES.map(compileSignature);

/** Plain, separator-free integer in Western digits. Locale-neutral, so it constrains no locale. */
const PLAIN_INTEGER_REGEX = /^[+-]?[0-9]+$/;

// Deterministic tie-break ordering (rough global prevalence) used when neither the OS locale
// nor its language disambiguates between candidates.
const LOCALE_PRIORITY: readonly string[] = [
	'en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'pt-BR', 'ru-RU',
	'zh-CN', 'ja-JP', 'ko-KR', 'es-MX', 'es-419', 'pt-PT', 'en-CA', 'en-IN',
	'hi-IN', 'zh-TW', 'zh-HK', 'ar-SA'
];

const LOCALE_TO_SIGNATURE = new Map<string, number>();
for (let s = 0; s < SIGNATURES.length; s++) {
	for (const locale of SIGNATURES[s].locales) {
		LOCALE_TO_SIGNATURE.set(locale, s);
	}
}

interface ColumnStats {
	total: number;
	empty: number;
	plainInteger: number;
	decimalCount: number[];
	groupedCount: number[];
	notMatched: number[];
}

interface ColumnCandidates {
	kind: 'text' | 'numeric';
	/** Signature indices under which every non-empty cell is numeric. */
	candidateSigs: number[];
	/** Locales of all candidate signatures. */
	candidateLocales: Set<string>;
	/** Candidate signature indices that contain at least one decimal value. */
	decimalSigs: Set<number>;
	/** True when the column contains grouping/decimal values that restrict the locale. */
	constrains: boolean;
}

/**
 * Detects the datatype (TEXT / INTEGER / DECIMAL) of each column from a sample of CSV rows.
 *
 * The first `maxRows` rows are split into cells and per-column statistics are accumulated. For
 * DECIMAL (and grouping-bearing INTEGER) columns the number-formatting locale is inferred by
 * matching cells against per-locale regexes; ambiguity is resolved by finding a locale that
 * fits every numeric column, then by the OS locale, then by a fixed priority order.
 *
 * @returns one `ColumnDataType` per column, in column order. The default is TEXT.
 */
export function detectColumnDataTypes(
	rows: string[],
	separator: string,
	options: DetectColumnDataTypesOptions = {}
): ColumnDataType[] {
	const hasHeader = options.hasHeader ?? false;
	const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
	const osLocale = options.osLocale ?? detectOsLocale();

	const headerOffset = hasHeader ? 1 : 0;
	const dataRows = rows.slice(headerOffset, headerOffset + maxRows);
	const splitData = dataRows.map(row => splitCells(row, separator));

	let columnCount = 0;
	if (hasHeader && rows.length > 0) {
		columnCount = splitCells(rows[0], separator).length;
	}
	for (const cells of splitData) {
		columnCount = Math.max(columnCount, cells.length);
	}

	if (columnCount === 0) {
		return [];
	}

	const columns = Array.from({ length: columnCount }, createColumnStats);
	for (const cells of splitData) {
		for (let c = 0; c < columnCount; c++) {
			accumulateCell(columns[c], c < cells.length ? cells[c] : '');
		}
	}

	const candidates = columns.map(toCandidates);
	const chosenLocale = resolveDocumentLocale(candidates, osLocale);

	return candidates.map(candidate => emitColumnType(candidate, chosenLocale, osLocale));
}

function accumulateCell(stats: ColumnStats, rawCell: string): void {
	stats.total += 1;

	const cell = rawCell.trim();
	if (cell.length === 0) {
		stats.empty += 1;
		return;
	}

	if (PLAIN_INTEGER_REGEX.test(cell)) {
		stats.plainInteger += 1;
		return;
	}

	for (let s = 0; s < COMPILED_SIGNATURES.length; s++) {
		const signature = COMPILED_SIGNATURES[s];
		if (signature.decimalRegex.test(cell)) {
			stats.decimalCount[s] += 1;
		} else if (signature.groupedIntegerRegex.test(cell)) {
			stats.groupedCount[s] += 1;
		} else {
			stats.notMatched[s] += 1;
		}
	}
}

function toCandidates(stats: ColumnStats): ColumnCandidates {
	const nonEmpty = stats.total - stats.empty;
	if (nonEmpty === 0) {
		return emptyCandidates();
	}

	const candidateSigs: number[] = [];
	const candidateLocales = new Set<string>();
	const decimalSigs = new Set<number>();

	for (let s = 0; s < COMPILED_SIGNATURES.length; s++) {
		// A signature is a candidate when every non-empty cell is either a plain integer
		// (locale-neutral) or matches this signature.
		if (stats.notMatched[s] !== 0) {
			continue;
		}

		candidateSigs.push(s);
		for (const locale of COMPILED_SIGNATURES[s].locales) {
			candidateLocales.add(locale);
		}
		if (stats.decimalCount[s] > 0) {
			decimalSigs.add(s);
		}
	}

	if (candidateSigs.length === 0) {
		return emptyCandidates();
	}

	return {
		kind: 'numeric',
		candidateSigs,
		candidateLocales,
		decimalSigs,
		constrains: stats.plainInteger < nonEmpty
	};
}

function resolveDocumentLocale(candidates: ColumnCandidates[], osLocale: string): string | undefined {
	const constraining = candidates.filter(candidate => candidate.kind === 'numeric' && candidate.constrains);
	if (constraining.length === 0) {
		return undefined;
	}

	let intersection: Set<string> | undefined;
	for (const candidate of constraining) {
		if (intersection === undefined) {
			intersection = new Set(candidate.candidateLocales);
			continue;
		}
		for (const locale of [...intersection]) {
			if (!candidate.candidateLocales.has(locale)) {
				intersection.delete(locale);
			}
		}
	}

	if (intersection === undefined || intersection.size === 0) {
		return undefined;
	}

	return mostProbableLocale(intersection, osLocale);
}

function emitColumnType(
	candidate: ColumnCandidates,
	chosenLocale: string | undefined,
	osLocale: string
): ColumnDataType {
	if (candidate.kind === 'text') {
		return { type: ColumnType.TEXT };
	}

	if (!candidate.constrains) {
		// Only plain, separator-free integers: numeric but locale-neutral.
		return { type: ColumnType.INTEGER };
	}

	const locale = chosenLocale !== undefined && candidate.candidateLocales.has(chosenLocale)
		? chosenLocale
		: mostProbableLocale(candidate.candidateLocales, osLocale);
	const signature = LOCALE_TO_SIGNATURE.get(locale)!;

	if (candidate.decimalSigs.has(signature)) {
		return { type: ColumnType.DECIMAL, locale };
	}

	return { type: ColumnType.INTEGER, locale };
}

function mostProbableLocale(set: Set<string>, osLocale: string): string {
	if (set.has(osLocale)) {
		return osLocale;
	}

	const osLanguage = languageOf(osLocale);
	for (const locale of LOCALE_PRIORITY) {
		if (set.has(locale) && languageOf(locale) === osLanguage) {
			return locale;
		}
	}

	for (const locale of LOCALE_PRIORITY) {
		if (set.has(locale)) {
			return locale;
		}
	}

	return set.values().next().value!;
}

function languageOf(locale: string): string {
	return locale.split('-')[0].toLowerCase();
}

function detectOsLocale(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
	} catch {
		return 'en-US';
	}
}

function compileSignature(signature: NumberSignature): CompiledSignature {
	const d = `[${signature.digit}]`;
	const g = signature.group;
	const dec = signature.decimal;

	const groupedInteger = signature.grouping === 'indian'
		? `${d}{1,2}(?:${g}${d}{2})*${g}${d}{3}`
		: `${d}{1,3}(?:${g}${d}{3})+`;
	const integerBody = `(?:${groupedInteger}|${d}+)`;

	// A DECIMAL must contain the decimal separator (this is what distinguishes it from an
	// INTEGER): either `<int><dec><digits?>` (e.g. 1.234,56 / 5,) or `<dec><digits>` (e.g. ,5).
	const decimalPattern = `^[+-]?(?:${integerBody}${dec}${d}*|${dec}${d}+)$`;
	const groupedIntegerPattern = `^[+-]?${groupedInteger}$`;

	return {
		locales: signature.locales,
		decimalRegex: new RegExp(decimalPattern),
		groupedIntegerRegex: new RegExp(groupedIntegerPattern)
	};
}

function createColumnStats(): ColumnStats {
	return {
		total: 0,
		empty: 0,
		plainInteger: 0,
		decimalCount: new Array(SIGNATURES.length).fill(0),
		groupedCount: new Array(SIGNATURES.length).fill(0),
		notMatched: new Array(SIGNATURES.length).fill(0)
	};
}

function emptyCandidates(): ColumnCandidates {
	return {
		kind: 'text',
		candidateSigs: [],
		candidateLocales: new Set(),
		decimalSigs: new Set(),
		constrains: false
	};
}
