/**
 * Copy plain text to the clipboard, from a user gesture (menu click, button).
 *
 * Tries the async Clipboard API first and falls back to a hidden textarea + execCommand for
 * environments where it is unavailable, restoring focus afterwards. For Ctrl+C the grid instead
 * intercepts the native `copy` event, which needs neither permissions nor focus juggling.
 */
export function copyTextToClipboard(value: string): void {
	const clipboard = navigator.clipboard;
	if (clipboard !== undefined) {
		void clipboard.writeText(value).catch(() => copyViaExecCommand(value));
		return;
	}

	copyViaExecCommand(value);
}

function copyViaExecCommand(value: string): void {
	const previouslyFocused = document.activeElement as HTMLElement | null;
	const textarea = document.createElement('textarea');
	textarea.value = value;
	textarea.setAttribute('aria-hidden', 'true');
	textarea.style.position = 'fixed';
	textarea.style.top = '0';
	textarea.style.left = '0';
	textarea.style.opacity = '0';
	textarea.style.pointerEvents = 'none';
	document.body.appendChild(textarea);

	textarea.select();
	try {
		document.execCommand('copy');
	} finally {
		document.body.removeChild(textarea);
		previouslyFocused?.focus({ preventScroll: true });
	}
}
