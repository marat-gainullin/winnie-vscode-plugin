import * as path from 'path';
import * as vscode from 'vscode';
import { getNonce } from './util';
import { KengaViewDocument } from './kenga-view-document';
import { WinnieEdit } from './winnie-edit';

/**
 * Provider for Kenga views' editors.
 * 
 */
export class ViewEditorProvider implements vscode.CustomEditorProvider<KengaViewDocument> {

	private static newKengaViewFileId = 1;

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		vscode.commands.registerCommand('kengaViews.winnie.openWith', () => {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (workspaceFolders) {
				const uri: vscode.Uri = workspaceFolders[0].uri;
				vscode.commands.executeCommand('vscode.openWith', uri, ViewEditorProvider.viewType);
			}
		});

		return vscode.window.registerCustomEditorProvider(
			ViewEditorProvider.viewType,
			new ViewEditorProvider(context),
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
				supportsMultipleEditorsPerDocument: false,
			});
	}

	private static readonly viewType = 'kengaViews.winnie';

	private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<KengaViewDocument>>();

	public get onDidChangeCustomDocument(): vscode.Event<vscode.CustomDocumentEditEvent<KengaViewDocument>> {
		return this._onDidChangeCustomDocument.event;
	}

	constructor(
		private readonly _context: vscode.ExtensionContext
	) { }

	//#region CustomEditorProvider

	async openCustomDocument(
		uri: vscode.Uri,
		openContext: { backupId?: string },
		_cancelToken: vscode.CancellationToken
	): Promise<KengaViewDocument> {
		const document = await KengaViewDocument.create(uri, openContext.backupId);
		const changeReg = document.onDidChange(e => {
			// Tell VS Code that the document has been edited by the user.
			this._onDidChangeCustomDocument.fire({
				document,
				...e,
			});
		})
		const disposeReg = document.onDidDispose(() => {
			changeReg.dispose()
			disposeReg.dispose()
		})
		return document;
	}

	async resolveCustomEditor(
		document: KengaViewDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		webviewPanel.webview.options = { enableScripts: true };
		webviewPanel.webview.html = this.getHtmlForWebView(webviewPanel.webview);

		const messageReg = webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, webviewPanel, e));
		const documentContentChangeReg = document.onDidChangeContent(e => {
			// Update the webview when the document changes
			webviewPanel.webview.postMessage({
				type: 'content-changed',
				content: e.content
			});
		});
		const documentWillSaveReg = document.onWillSave(e => {
			webviewPanel.webview.postMessage({
				type: 'content-generate',
				ts: document.uri.fsPath.endsWith('.ts')
			});
		});
		const disposeReg = webviewPanel.onDidDispose(() => {
			messageReg.dispose()
			documentContentChangeReg.dispose()
			documentWillSaveReg.dispose()
			disposeReg.dispose()
		});
	}

	public saveCustomDocument(document: KengaViewDocument, cancellation: vscode.CancellationToken): Thenable<void> {
		return document.save(cancellation);
	}

	public saveCustomDocumentAs(document: KengaViewDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Thenable<void> {
		return document.saveAs(destination, cancellation);
	}

	public revertCustomDocument(document: KengaViewDocument, cancellation: vscode.CancellationToken): Thenable<void> {
		return document.revert(cancellation);
	}

	public backupCustomDocument(document: KengaViewDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
		return document.backup(context.destination, cancellation);
	}

	//#endregion

	/**
	 * Get the static HTML used for in our editor's webviews.
	 */
	private getHtmlForWebView(webview: vscode.Webview): string {
		// Local path to script and css for the webview
		const winnieUri = webview.asWebviewUri(vscode.Uri.file(
			path.join(this._context.extensionPath, 'editor-web-view', 'winnie', 'start.js')
		));
		const styleStartUri = webview.asWebviewUri(vscode.Uri.file(
			path.join(this._context.extensionPath, 'editor-web-view', 'winnie', 'assets', 'start.css')
		));
		const hooksUri = webview.asWebviewUri(vscode.Uri.file(
			path.join(this._context.extensionPath, 'editor-web-view', 'hooks.js')
		));
		const stylePluginUri = webview.asWebviewUri(vscode.Uri.file(
			path.join(this._context.extensionPath, 'editor-web-view', 'theme.css')
		));

		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce();

		return /* html */`
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
				Use a content security policy to only allow loading images from https or from our extension directory,
				and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'self'; font-src ${webview.cspSource}; img-src ${webview.cspSource} blob:; style-src 'self' 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleStartUri}" rel="stylesheet" />
				<link href="${stylePluginUri}" rel="stylesheet" />

				<title>Winnie</title>
			</head>
			<body class="design-view">
				<script nonce="${nonce}" src="${winnieUri}"></script>
				<script nonce="${nonce}" src="${hooksUri}"></script>
			</body>
			</html>`;
	}

	private onMessage(document: KengaViewDocument, webviewPanel: vscode.WebviewPanel, message: any) {
		switch (message.type) {
			// Wait for the webview to be properly ready before we init
			case 'ready':
				webviewPanel.webview.postMessage({
					type: 'content-init',
					content: document.documentData
				});
				break;
			case 'content-generated':
				document.resolvePendingSave(message.content)
				break;
			case 'content-not-generated':
				document.rejectPendingSave(message.content)
				break;
			case 'edit-happend':
				// TODO: Think on how to post message to the WebView. Maybe it is worth it to this without document at all.
				document.editHappend(message.label, webviewPanel.webview);
				break;
			case 'alert':
				vscode.window.showErrorMessage(message.content)
				break;
		}
	}
}
