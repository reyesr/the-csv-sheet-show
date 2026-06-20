import * as fs from 'fs';
import * as vscode from 'vscode';

interface ViteManifestEntry {
	file: string;
	css?: string[];
}

type ViteManifest = Record<string, ViteManifestEntry>;

/**
 * Builds the HTML document (with CSP) served into the custom-editor webview, switching between
 * the Vite dev server and the built `dist/webview` bundle.
 */
export class WebviewContentProvider {
	public constructor(private readonly extensionUri: vscode.Uri) { }

	/** Root the webview is allowed to load local resources from (also used for `localResourceRoots`). */
	public getDistUri(): vscode.Uri {
		return vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
	}

	public getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		const devServer = this.getDevServer();

		if (devServer !== undefined) {
			return this.getDevelopmentHtml(webview, nonce, devServer);
		}

		return this.getProductionHtml(webview, nonce);
	}

	private getDevelopmentHtml(webview: vscode.Webview, nonce: string, devServer: string): string {
		const devOrigin = new URL(devServer).origin;
		const websocketOrigin = devOrigin.replace(/^http/, 'ws');
		const csp = [
			"default-src 'none'",
			`img-src ${webview.cspSource} ${devOrigin} data:`,
			`font-src ${webview.cspSource} ${devOrigin}`,
			`style-src ${webview.cspSource} ${devOrigin} 'unsafe-inline'`,
			`script-src 'nonce-${nonce}' ${devOrigin}`,
			`connect-src ${devOrigin} ${websocketOrigin}`
		].join('; ');

		return this.getWebviewDocument(csp, [
			`<script nonce="${nonce}" type="module" src="${devOrigin}/@vite/client"></script>`,
			`<script nonce="${nonce}" type="module" src="${devOrigin}/src/main.tsx"></script>`
		]);
	}

	private getProductionHtml(webview: vscode.Webview, nonce: string): string {
		const webviewDistUri = this.getDistUri();
		const manifestUri = vscode.Uri.joinPath(webviewDistUri, 'manifest.json');
		const manifest = JSON.parse(fs.readFileSync(manifestUri.fsPath, 'utf8')) as ViteManifest;
		const entry = manifest['index.html'] ?? manifest['src/main.tsx'];

		if (entry === undefined) {
			throw new Error('Missing webview entry in dist/webview/manifest.json. Run npm run build:webview.');
		}

		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDistUri, entry.file));
		const styleTags = (entry.css ?? []).map(cssFile => {
			const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDistUri, cssFile));
			return `<link rel="stylesheet" href="${styleUri}">`;
		});
		const csp = [
			"default-src 'none'",
			`img-src ${webview.cspSource} data:`,
			`font-src ${webview.cspSource}`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`script-src 'nonce-${nonce}'`
		].join('; ');

		return this.getWebviewDocument(csp, [
			...styleTags,
			`<script nonce="${nonce}" type="module" src="${scriptUri}"></script>`
		]);
	}

	private getWebviewDocument(csp: string, tags: string[]): string {
		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<meta http-equiv="Content-Security-Policy" content="${csp}">
				<title>CSV Viewer</title>
				${tags.join('\n\t\t\t\t')}
			</head>
			<body>
				<div id="root"></div>
			</body>
			</html>`;
	}

	private getDevServer(): string | undefined {
		const configuredDevServer = process.env.CSV_SHEET_SHOW_WEBVIEW_DEV_SERVER?.trim();

		if (configuredDevServer !== undefined && configuredDevServer.length > 0) {
			return configuredDevServer.replace(/\/$/, '');
		}

		return undefined;
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}

	return text;
}
