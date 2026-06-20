import * as chardet from 'chardet';
import * as iconv from 'iconv-lite';

export function detectBufferEncoding(input?: string): BufferEncoding | null {
    if (!input) {
        return 'utf8';
    }
    const e = input.toLowerCase().trim().replace(/[_\s]+/g, '').replace(/^(?:encoding:)/, '');

    switch (e) {
        case 'utf8':
        case 'utf-8':
            return 'utf8';
        case 'utf16':
        case 'utf-16':
        case 'utf16le':
        case 'utf-16le':
        case 'ucs2':
        case 'ucs-2':
            return 'utf16le';

        case 'ascii':
        case 'latin1':
        case 'iso88591':
        case 'iso-8859-1':
            return 'latin1';
        default:
            return null;
    }
}

const DEFAULT_ENCODING_FOR_DECODE = 'utf-8';

export function decodeBuffer(buffer: Buffer, providedEncoding?: string): string {
    const detected = providedEncoding ?? (chardet.detect(buffer) as string | null) ?? undefined;
    const mapped = detectBufferEncoding(detected);

    if (mapped) {
        try {
            return buffer.toString(mapped);
        } catch (e) {
            // fallthrough to iconv
        }
    }

    try {
        return iconv.decode(buffer, detected ?? DEFAULT_ENCODING_FOR_DECODE);
    } catch (error) {
        // If iconv fails, fall back to utf-8 with error handling
        console.warn('Failed to decode buffer with fallback encoding, using utf-8 with replacement', error);
        return buffer.toString('utf-8');
    }
}

export function detectLineEndings(text: string, encoding: string): string {
    // Single pass through text for better performance
    let crlfCount = 0;
    let lfCount = 0;
    let crCount = 0;
    
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
            crlfCount++;
            i++; // Skip next character as we've already processed it
        } else if (text[i] === '\n') {
            lfCount++;
        } else if (text[i] === '\r') {
            crCount++;
        }
    }
    
    if (crlfCount > lfCount && crlfCount > crCount) {
        return 'CRLF';
    } else if (crCount > lfCount) {
        return 'CR';
    } else {
        return 'LF'; // Return default LF (the most common))
    }
}
