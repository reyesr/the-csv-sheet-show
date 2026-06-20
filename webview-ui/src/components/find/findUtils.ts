import type { FindMatchMessage } from '../../../../src/shared/messages/find';

export interface HighlightPart {
	text: string;
	match: FindMatchMessage | null;
}

export function splitHighlightedText(value: string, matches: FindMatchMessage[]): HighlightPart[] {
	if (matches.length === 0) {
		return [{ text: value, match: null }];
	}

	const parts: HighlightPart[] = [];
	let cursor = 0;
	const sortedMatches = [...matches].sort((left, right) => left.start - right.start || left.end - right.end);

	for (const match of sortedMatches) {
		if (match.start < cursor || match.start > value.length) {
			continue;
		}

		if (match.start > cursor) {
			parts.push({ text: value.slice(cursor, match.start), match: null });
		}

		const end = Math.min(match.end, value.length);
		parts.push({ text: value.slice(match.start, end), match });
		cursor = end;
	}

	if (cursor < value.length) {
		parts.push({ text: value.slice(cursor), match: null });
	}

	return parts;
}

export function findCellKey(rowIndex: number, cellIndex: number): string {
	return `${rowIndex}:${cellIndex}`;
}

export function createSearchId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}

	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
