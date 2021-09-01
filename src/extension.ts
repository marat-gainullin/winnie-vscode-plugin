import * as vscode from 'vscode';
import { ViewEditorProvider } from './viewEditor';

export function activate(context: vscode.ExtensionContext) {
	// Register custom editor provider
	context.subscriptions.push(ViewEditorProvider.register(context));
}
