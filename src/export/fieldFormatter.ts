import { CellType, DecimalSeparator, detectCellType } from '../csv/DataTypes';
import type { ExportColumn, FormattedField } from './types';

/**
 * Builds the `formatField` used by every encoder. It does not *detect* types — each column already
 * has a user-assigned type (default `text`); the formatter *applies* it, coercing the raw cell to the
 * type's semantic kind and reporting (via `coerced === undefined`) when a value does not satisfy its
 * assigned type so the encoder can fall back. Decimal normalization follows `config.decimalSeparator`.
 *
 * See local/features/exports/architecture.md §3.2 / §3.5.
 */
export function createFieldFormatter(
	columns: ExportColumn[],
	decimalSeparator: DecimalSeparator
): (raw: string, columnIndex: number) => FormattedField {
	return (raw, columnIndex) => {
		const trimmed = raw.trim();
		if (trimmed.length === 0) {
			return { raw, empty: true };
		}

		switch (columns[columnIndex]?.kind ?? 'text') {
			case 'numeric':
				return formatNumeric(raw, decimalSeparator);
			case 'boolean':
				return formatBoolean(raw, trimmed);
			case 'date':
				return formatDate(raw, trimmed);
			case 'text':
			default:
				return { raw, empty: false, coerced: raw };
		}
	};
}

/**
 * Coerce to a canonical numeric string (decimal `.`, no leading `+`). Reuses `detectCellType` so the
 * notion of "numeric" matches the rest of the codebase; a non-numeric cell yields no `coerced` value.
 */
function formatNumeric(raw: string, decimalSeparator: DecimalSeparator): FormattedField {
	if (detectCellType(raw, decimalSeparator) !== CellType.NUMBER) {
		return { raw, empty: false };
	}

	// A NUMBER has at most one decimal separator (`.` or `,`) plus digits and an optional sign, so
	// dropping a leading `+` and mapping the lone comma to a dot yields a canonical decimal string.
	const coerced = raw.trim().replace(/^\+/, '').replace(',', '.');
	return { raw, empty: false, coerced };
}

function formatBoolean(raw: string, trimmed: string): FormattedField {
	const lower = trimmed.toLowerCase();
	if (lower === 'true' || lower === 'false') {
		return { raw, empty: false, coerced: lower };
	}
	return { raw, empty: false };
}

function formatDate(raw: string, trimmed: string): FormattedField {
	const time = Date.parse(trimmed);
	if (Number.isNaN(time)) {
		return { raw, empty: false };
	}
	return { raw, empty: false, coerced: new Date(time).toISOString() };
}
