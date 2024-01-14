import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';
import { WinnieEdit } from './winnie-edit';

/**
 * Define the document (the data model) used for Kenga views.
 */
export class KengaViewDocument implements vscode.CustomDocument {

	static async create(
		uri: vscode.Uri,
		backupId: string | undefined
	): Promise<KengaViewDocument | PromiseLike<KengaViewDocument>> {
		// If we have a backup, read that. Otherwise read the resource from the workspace
		const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
		const fileData = await KengaViewDocument.readFile(dataFile);
		const decoder = new TextDecoder()
		return new KengaViewDocument(uri, decoder.decode(fileData));
	}

	private static async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		if (uri.scheme === 'untitled') {
			return new Uint8Array();
		} else {
			return vscode.workspace.fs.readFile(uri);
		}
	}

	private _uri: vscode.Uri;
	private _documentData: string;
	private _watcher: vscode.FileSystemWatcher;
	private _watchOnChange: vscode.Disposable | null = null;
	private _pendingSave: any | null = null

	private constructor(uri: vscode.Uri, initialContent: string) {
		this._uri = uri;
		this._documentData = initialContent;
		this._watcher = vscode.workspace.createFileSystemWatcher(uri.fsPath, true, false, true);
		this.watchFile()
	}

	public get uri() { return this._uri; }

	public get documentData(): string { return this._documentData; }

	private readonly _onDidDispose = new vscode.EventEmitter<void>();
	/**
	 * Fired when the document is disposed of.
	 */
	public get onDidDispose(): vscode.Event<any> {
		return this._onDidDispose.event;
	}

	private readonly _onDidChangeContent = new vscode.EventEmitter<{
		readonly content?: string;
	}>();

	/**
	 * Fired to notify webviews that the document has changed.
	 */
	public get onDidChangeContent(): vscode.Event<{
		readonly content?: string;
	}> {
		return this._onDidChangeContent.event;
	}

	private readonly _onWillSave = new vscode.EventEmitter<void>();
	/**
	 * Fired when the document is about to save its contents.
	 */
	public get onWillSave(): vscode.Event<any> {
		return this._onWillSave.event;
	}

	private readonly _onDidChange = new vscode.EventEmitter<WinnieEdit>();

	/**
	 * Fired to tell VS Code that an edit has occured in the document.
	 *
	 * This updates the document's dirty indicator.
	 */
	public get onDidChange(): vscode.Event<WinnieEdit> {
		return this._onDidChange.event;
	}

	private async fileChanged() {
		const diskContent = await KengaViewDocument.readFile(this.uri);
		const decoder = new TextDecoder()
		const data = decoder.decode(diskContent)
		this._documentData = data;
		this._onDidChangeContent.fire({ content: data });
	}

	private watchFile() {
		const timeoutReg = setTimeout(() => {
			clearTimeout(timeoutReg)
			if (this._watchOnChange == null) {
				this._watchOnChange = this._watcher.onDidChange(() => {
					this.fileChanged()
				});
			}
		}, 1000);
	}

	private unwatchFile() {
		if (this._watchOnChange) {
			this._watchOnChange.dispose();
			this._watchOnChange = null
		}
	}
	/**
	 * Called by VS Code when there are no more references to the document.
	 *
	 * This happens when all editors for it have been closed.
	 */
	dispose(): void {
		this.unwatchFile()
		this._watcher.dispose();
		this._onDidDispose.fire();
		this._onDidDispose.dispose();
		this._onDidChangeContent.dispose();
		this._onDidChange.dispose();
	}

	/**
	 * Called when the user edits the document in a webview.
	 *
	 * This fires an event to notify VS Code that the document has been edited.
	 */
	editHappend(label: string, webview: vscode.Webview) {
		this._onDidChange.fire({
			label,
			undo: () => {
				webview.postMessage({ type: 'undo' })
			},
			redo: () => {
				webview.postMessage({ type: 'redo' })
			}
		});
	}

	/**
	 * Called by VS Code when the user saves the document.
	 */
	async save(cancellation: vscode.CancellationToken): Promise<void> {
		await this.saveAs(this.uri, cancellation);
	}

	/**
	 * Called by VS Code when the user saves the document to a new location.
	 */
	saveAs(targetResource: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
		if (!cancellation.isCancellationRequested) {
			return new Promise((resolve, reject) => {
				this.unwatchFile()
				this._pendingSave = { resolve, reject, targetResource, cancellation }
				this._onWillSave.fire()
			})
		} else {
			return Promise.resolve()
		}
	}

	async resolvePendingSave(data: string): Promise<void> {
		const pendingSave = this._pendingSave
		this._pendingSave = null
		if (pendingSave != null && !pendingSave.cancellation.isCancellationRequested) {
			try {
				const encoder = new TextEncoder()
				await vscode.workspace.fs.writeFile(pendingSave.targetResource, encoder.encode(data));
				if (this._uri == pendingSave.targetResource) {
					this._documentData = data
				}
				pendingSave.resolve()
			} catch (e) {
				pendingSave.reject(e)
			}
		}
		this.watchFile()
	}

	rejectPendingSave(reason: any) {
		const pendingSave = this._pendingSave
		this._pendingSave = null
		if (pendingSave != null) {
			pendingSave.reject(reason)
		}
		this.watchFile()
	}

	/**
	 * Called by VS Code when the user calls `revert` on a document.
	 */
	async revert(_cancellation: vscode.CancellationToken): Promise<void> {
		const diskContent = await KengaViewDocument.readFile(this.uri);
		const decoder = new TextDecoder()
		const data = decoder.decode(diskContent)
		this._documentData = data;
		this._pendingSave = null
		this._onDidChangeContent.fire({ content: data });
	}

	/**
	 * Called by VS Code to backup the edited document.
	 *
	 * These backups are used to implement hot exit.
	 */
	async backup(destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
		await this.saveAs(destination, cancellation);

		return {
			id: destination.toString(),
			delete: async () => {
				try {
					await vscode.workspace.fs.delete(destination);
				} catch (ex) {
					console.error(ex)
				}
			}
		};
	}
}
