import { getDiffieHellman } from 'crypto';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	
	console.log('Congratulations, your extension "tagit" is now active!');

	const workspaceState = context.workspaceState;

	// async tagFile command
	const tagFileCommand = vscode.commands.registerCommand('tagit.tagFile', async () => {
		// currently active text editor
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage("No file is currently open. Please choose a file.");
			return;	// no open text editor
		}

		const filePath = editor.document.uri.fsPath;
		const tagsInput = await vscode.window.showInputBox({
			prompt: `Enter tags (comma-separated)`,
			placeHolder: `e.g., #stack, #heap`,
			value: getFileTags(filePath, workspaceState).join(", ")	// pre fill the input box with existing tags
		});

		if (tagsInput) {
			const tags = tagsInput.split(",").map(tag => tag.trim());
			setFileTags(filePath, tags, workspaceState);			// store the tags into the workspace
			console.log(`File: ${filePath}, Tags: ${tags}`);

			vscode.window.showInformationMessage(`Tags added to the current file.`);
		} else {
			vscode.window.showInformationMessage(`Tagging cancelled.`);
		}

		vscode.window.showInformationMessage('Tagging this file.');
	});

	context.subscriptions.push(tagFileCommand);
}

/**
 * Gets the tags associated with a given file
 * @param filePath The absolute path of the current file
 * @param workspaceState VSCode's workspace state memento
 * @returns An array of tags associated with the file
 */
function getFileTags(filePath: string, workspaceState: vscode.Memento) : string[] {
	const tags = workspaceState.get<string[]>(filePath);
	return tags || [];	// return empty array if no tags are found
} 

/**
 * Sets tags to a given file
 * @param filePath The absolute path of the current file
 * @param tags The tags to be added to the file
 * @param workspaceState VSCode's workspace state memento
 */
function setFileTags(filePath: string, tags: string[], workspaceState: vscode.Memento) {
	workspaceState.update(filePath, tags);
}


// This method is called when your extension is deactivated
export function deactivate() {}
