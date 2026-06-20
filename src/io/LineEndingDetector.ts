/**
 * Incrementally detects the most likely line ending style across multiple content chunks.
 * A trailing CR is kept pending between addContent() calls so split CRLF sequences are counted correctly.
 */
export class LineEndingDetector {
	private static readonly CR = 13;
	private static readonly LF = 10;

	private crlfCount = 0;
	private lfCount = 0;
	private crCount = 0;
	private hasPendingCr = false; // Tracks if the last character processed was a CR, over multiple calls to addContent

	public addContent(content: string): void {
		let start = 0;

		if (this.hasPendingCr) {
			if (content.charCodeAt(0) === LineEndingDetector.LF) {
				this.crlfCount += 1;
				start = 1;
			} else {
				this.crCount += 1;
			}

			this.hasPendingCr = false;
		}

		for (let i = start; i < content.length; i++) {
			const charCode = content.charCodeAt(i);

			if (charCode === LineEndingDetector.CR) {
				if (i + 1 >= content.length) {
					this.hasPendingCr = true;
				} else if (content.charCodeAt(i + 1) === LineEndingDetector.LF) {
					this.crlfCount += 1;
					i += 1;
				} else {
					this.crCount += 1;
				}
			} else if (charCode === LineEndingDetector.LF) {
				this.lfCount += 1;
			}
		}
	}

	public getMostLikelyLineEndings(): string {
		const crCount = this.crCount + (this.hasPendingCr ? 1 : 0);

		if (this.crlfCount > this.lfCount && this.crlfCount > crCount) {
			return 'CRLF';
		} else if (crCount > this.lfCount) {
			return 'CR';
		} else {
			return 'LF';
		}
	}
}
