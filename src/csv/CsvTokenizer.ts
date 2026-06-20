export enum CsvTokenizedPartType {
	QUOTED,
	UNQUOTED,
	END_OF_CONTENT
}

export interface CsvTokenizedPart {
	start: number;
	end: number;
	type: CsvTokenizedPartType;
}

/**
 * Tokenizes CSV content into quoted and unquoted ranges; call parse() until END_OF_CONTENT.
 * Handles RFC-style escaped quotes ("") and line endings inside quoted cells, so callers
 * can avoid incorrectly splitting records while inside a quoted value.
 */
export class CsvTokenizer {
	private cursor = 0;
	private readonly text: string;

	public constructor(text: string) {
		this.text = text;
	}

	public parse(): CsvTokenizedPart {
		if (this.cursor >= this.text.length) {
			return {
				start: this.text.length,
				end: this.text.length,
				type: CsvTokenizedPartType.END_OF_CONTENT
			};
		}

		if (this.text[this.cursor] === '"') {
			return this.parseQuotedPart();
		}

		return this.parseUnquotedPart();
	}

	private parseQuotedPart(): CsvTokenizedPart {
		const start = this.cursor + 1;
		this.cursor += 1;

		while (this.cursor < this.text.length) {
			if (this.text[this.cursor] !== '"') {
				this.cursor += 1;
				continue;
			}

			if (this.text[this.cursor + 1] === '"') {
				this.cursor += 2;
				continue;
			}

			const end = this.cursor;
			this.cursor += 1;

			return {
				start,
				end,
				type: CsvTokenizedPartType.QUOTED
			};
		}

		return {
			start,
			end: this.text.length,
			type: CsvTokenizedPartType.QUOTED
		};
	}

	private parseUnquotedPart(): CsvTokenizedPart {
		const start = this.cursor;

		while (this.cursor < this.text.length && this.text[this.cursor] !== '"') {
			this.cursor += 1;
		}

		return {
			start,
			end: this.cursor,
			type: CsvTokenizedPartType.UNQUOTED
		};
	}
}
