import type { WebviewToExtensionMessage } from '../../../src/shared/messages/protocol';
import { createExtensionEmulator, type ExtensionEmulator } from './createExtensionEmulator';

interface DevVsCodeApi {
	postMessage(message: WebviewToExtensionMessage): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare global {
	var acquireVsCodeApi: (() => DevVsCodeApi) | undefined;
	var __csvSheetShowEmulator: ExtensionEmulator | undefined;
}

export function installWebviewEmulator(): ExtensionEmulator {
	const emulator = createExtensionEmulator();
	let state: unknown;

	globalThis.__csvSheetShowEmulator = emulator;
	globalThis.acquireVsCodeApi = () => ({
		postMessage: message => emulator.handleWebviewMessage(message),
		getState: () => state,
		setState: nextState => { state = nextState; }
	});

	return emulator;
}
