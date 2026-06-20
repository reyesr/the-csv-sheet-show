import { createSignal, onCleanup } from 'solid-js';
import type { SaveController } from '../../types';

/** Delay before the save-progress indicator appears, so quick saves stay silent (debounce). */
const SAVE_INDICATOR_DELAY_MS = 300;

/**
 * Owns the toolbar's save-progress indicator. The extension brackets every save with
 * `saveStarted` / `saveComplete` and streams `saveProgress` between. This controller debounces the
 * display so nothing shows for saves shorter than {@link SAVE_INDICATOR_DELAY_MS}, then surfaces the
 * latest overall percentage once the delay elapses.
 */
export function createSaveController(): SaveController {
	const [progressVisible, setProgressVisible] = createSignal(false);
	const [progressPercent, setProgressPercent] = createSignal(0);
	let revealTimer: ReturnType<typeof setTimeout> | null = null;

	function clearRevealTimer(): void {
		if (revealTimer !== null) {
			clearTimeout(revealTimer);
			revealTimer = null;
		}
	}

	function handleSaveStarted(): void {
		clearRevealTimer();
		setProgressPercent(0);
		setProgressVisible(false);
		revealTimer = setTimeout(() => {
			revealTimer = null;
			setProgressVisible(true);
		}, SAVE_INDICATOR_DELAY_MS);
	}

	function handleSaveProgress(percent: number): void {
		setProgressPercent(clampPercent(percent));
	}

	function handleSaveComplete(): void {
		clearRevealTimer();
		setProgressVisible(false);
		setProgressPercent(0);
	}

	onCleanup(clearRevealTimer);

	return {
		progressVisible,
		progressPercent,
		handleSaveStarted,
		handleSaveProgress,
		handleSaveComplete
	};
}

function clampPercent(percent: number): number {
	if (Number.isNaN(percent)) {
		return 0;
	}

	return Math.max(0, Math.min(100, Math.round(percent)));
}
