import * as fs from 'fs';
import * as vscode from 'vscode';
import { CsvDocument, type CsvDocumentBackup } from './CsvDocument';
import { UiPreferenceStore } from './preferences/UiPreferenceStore';
import { ActivePanelTracker } from './webview/ActivePanelTracker';
import { WebviewContentProvider } from './webview/WebviewContentProvider';
import { WebviewMessageRouter } from './webview/WebviewMessageRouter';

export class CsvEditorProvider implements vscode.CustomEditorProvider<CsvDocument> {
	private readonly onDidChangeCustomDocumentEmitter = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<CsvDocument>>();
	private readonly outputChannel: vscode.OutputChannel;
	private readonly content: WebviewContentProvider;
	private readonly activePanels = new ActivePanelTracker();
	public readonly onDidChangeCustomDocument = this.onDidChangeCustomDocumentEmitter.event;

	public static register(context: vscode.ExtensionContext): vscode.Disposable[] {
		const provider = new CsvEditorProvider(context);
		return [
			vscode.window.registerCustomEditorProvider('csv-sheet-show.csvViewer', provider, {
				webviewOptions: { retainContextWhenHidden: true },
				supportsMultipleEditorsPerDocument: false
			}),
			...provider.registerCommands()
		];
	}

	public constructor(private readonly context: vscode.ExtensionContext) {
		this.outputChannel = vscode.window.createOutputChannel('CSV Sheet Show');
		this.context.subscriptions.push(this.outputChannel);
		this.content = new WebviewContentProvider(this.context.extensionUri);
	}

	public registerCommands(): vscode.Disposable[] {
		return [
			vscode.commands.registerCommand('csv-sheet-show.find', () => this.activePanels.post({ type: 'showFind' })),
			vscode.commands.registerCommand('csv-sheet-show.findNext', () => this.activePanels.post({ type: 'findNext' })),
			vscode.commands.registerCommand('csv-sheet-show.findPrevious', () => this.activePanels.post({ type: 'findPrevious' })),
			vscode.commands.registerCommand('csv-sheet-show.closeFind', () => this.activePanels.post({ type: 'closeFind' }))
		];
	}

	public openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext): CsvDocument {
		this.log(`Opening custom document: ${uri.fsPath}`);
		const document = new CsvDocument(uri, this.context, message => this.log(message));

		const backup = this.readBackup(openContext.backupId);
		if (backup !== null) {
			document.restoreBackup(backup);
		}

		// Every appended change registers a VS Code edit so the tab shows dirty and Ctrl+Z/Ctrl+Shift+Z route here.
		document.onDidEdit(({ label }) => {
			this.onDidChangeCustomDocumentEmitter.fire({
				document,
				label,
				undo: () => document.undoEdit(),
				redo: () => document.redoEdit()
			});
		});

		return document;
	}

	public async resolveCustomEditor(
		document: CsvDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.content.getDistUri()]
		};

		webviewPanel.webview.html = this.content.getHtml(webviewPanel.webview);
		this.activePanels.track(webviewPanel);
		document.attachPanel(webviewPanel);

		const preferences = new UiPreferenceStore(this.context.globalState, this.context.workspaceState);
		const router = new WebviewMessageRouter(document, preferences, message => this.log(message));
		webviewPanel.webview.onDidReceiveMessage(message => router.handle(message, webviewPanel));

		await document.ready;
	}

	private log(message: string): void {
		this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
	}

	public async saveCustomDocument(document: CsvDocument): Promise<void> {
		this.log(`Saving custom document: ${document.uri.fsPath}`);
		await document.save();
	}

	public async saveCustomDocumentAs(document: CsvDocument, destination: vscode.Uri): Promise<void> {
		this.log(`Saving custom document as: ${destination.fsPath}`);
		await document.saveAs(destination);
	}

	public revertCustomDocument(document: CsvDocument): Thenable<void> {
		this.log(`Reverting custom document: ${document.uri.fsPath}`);
		document.revert();
		return Promise.resolve();
	}

	public backupCustomDocument(document: CsvDocument, context: vscode.CustomDocumentBackupContext): Thenable<vscode.CustomDocumentBackup> {
		const backupUri = context.destination;
		try {
			fs.writeFileSync(backupUri.fsPath, JSON.stringify(document.serializeBackup()), 'utf8');
		} catch (error) {
			this.log(`Failed to write backup: ${error instanceof Error ? error.message : String(error)}`);
		}

		return Promise.resolve({
			id: backupUri.toString(),
			delete: () => {
				try {
					fs.unlinkSync(backupUri.fsPath);
				} catch {
					// Best effort: the backup file may already be gone.
				}
			}
		});
	}

	private readBackup(backupId: string | undefined): CsvDocumentBackup | null {
		if (backupId === undefined) {
			return null;
		}

		try {
			const contents = fs.readFileSync(vscode.Uri.parse(backupId).fsPath, 'utf8');
			return JSON.parse(contents) as CsvDocumentBackup;
		} catch (error) {
			this.log(`Failed to read backup ${backupId}: ${error instanceof Error ? error.message : String(error)}`);
			return null;
		}
	}
}
