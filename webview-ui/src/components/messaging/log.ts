import { postMessage } from '../../vscode';

export function log(level: string, message: string, data?: unknown): void {
	postMessage({
		type: 'log',
		level,
		message,
		data
	});
}
