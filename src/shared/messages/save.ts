/** A save has begun; the webview starts its debounce timer (no UI shown until it elapses). */
export interface SaveStartedMessage {
	type: 'saveStarted';
}

/** Overall save progress (0–100), spanning the write and re-index phases. */
export interface SaveProgressMessage {
	type: 'saveProgress';
	percent: number;
}

/** The save finished (success or failure); the webview clears any progress indicator. */
export interface SaveCompleteMessage {
	type: 'saveComplete';
}
