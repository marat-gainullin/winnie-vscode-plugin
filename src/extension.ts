import * as vscode from 'vscode';
import { ViewEditorProvider } from './view-editor-provider';

export function activate(context: vscode.ExtensionContext) {
	// Register custom editor provider
	context.subscriptions.push(ViewEditorProvider.register(context));
}
