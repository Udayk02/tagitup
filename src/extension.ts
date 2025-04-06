import * as vscode from 'vscode';
import {  ActiveFileTagsItem, ActiveFileTagItem, TagCategoryItem, TaggedFileItem, FileQuickPickItem } from './items';
import { parseTagQuery, TagExpression } from './tagexpression';

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "TagitUp" is now active!');

	const workspaceState = context.workspaceState;	// workspace state (kind of like a storage)

	const tagitupProvider = new TagitUpProvider(workspaceState);
	// register the data provider
	vscode.window.registerTreeDataProvider('tagitupTreeView', tagitupProvider);
	// refresh the data provider so that tree view also gets refreshed
	// when the active editor changes
	vscode.window.onDidChangeActiveTextEditor(() => {
		tagitupProvider.refresh(); // call refresh on the TreeDataProvider to update the entire tree
	});

	// listen for file rename events, this is only applicable for renames withing the vs code workspace
	vscode.workspace.onDidRenameFiles(event => {
		event.files.forEach(async renamedFile => {
			const oldFileUriString = renamedFile.oldUri.toString();
			const newFileUriString = renamedFile.newUri.toString();

			const tags = getFileTags(oldFileUriString, workspaceState); // get tags from old URI
			if (tags && tags.length > 0) {
				const success = await setFileTags(newFileUriString, tags, workspaceState);
				if (success) {
					clearFileTags(oldFileUriString, workspaceState);      // remove tags from old URI
					tagitupProvider.refresh(); // refresh tree view to update file paths
				}    // set tags for new URI
			}
		});
	});

	// listen for the file deletions
	vscode.workspace.onDidDeleteFiles(event => {
		event.files.forEach(deletedFile => {
			const deletedFileUriString = deletedFile.toString();
			clearFileTags(deletedFileUriString, workspaceState); // remove tags for the deleted file
		});
		tagitupProvider.refresh(); // refresh tree view to update file paths
	});

	vscode.window.onDidChangeWindowState(windowState => {
		if (windowState.focused) {
			tagitupProvider.refresh();
		}
	});

	// async tagFile command
	const tagFileCommand = vscode.commands.registerCommand('tagitup.tagFile', async () => {
		// currently active text editor
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage("No file is currently open. Please choose a file.");
			return;	// no open text editor
		}

		if (editor.document.isUntitled) {
			vscode.window.showInformationMessage("Please save the file before tagging.");
			return;	// unsaved file
		}

		const filePath = editor.document.uri.toString();	// uri is the vscode's representation for a resource
		const tagsInput = await vscode.window.showInputBox({
			prompt: `Enter tags (comma-separated, no space allowed)`,
			placeHolder: `e.g., #stack, #heap`,
			value: getFileTags(filePath, workspaceState).join(", ")	// pre fill the input box with existing tags
		});
		
		if (tagsInput) {
			const tags = tagsInput.split(",").map(tag => tag.trim()).filter(tag => tag.length > 0);
			// store the tags into the workspace
			const success = await setFileTags(filePath, tags, workspaceState); 
			if (success) {
				vscode.window.showInformationMessage(`Tags added to the current file.`);
				tagitupProvider.refresh();	// refresh
			}			
		} else {
			vscode.window.showInformationMessage(`Tagging cancelled.`);
		}
	});

	// clearWorkspaceState command
	const clearWorkspaceStateCommand = vscode.commands.registerCommand('tagitup.clearWorkspaceState', async () => {
		const confirmation = await vscode.window.showInformationMessage(
			'Are you sure you want to clear all the tags?',
			{ modal: true }, // make it a modal dialog (requires user confirmation)
			'Yes', 'No'
		);

		if (confirmation === 'Yes') {
			// get all keys from workspaceState
			const keys = workspaceState.keys();

			// clear each key
			for (const key of keys) {
				await workspaceState.update(key, undefined);
			}

			vscode.window.showInformationMessage('TagitUp workspace cleared.');
			tagitupProvider.refresh(); // refresh the tree view
		} else {
			vscode.window.showInformationMessage('Clear workspace cancelled.');
		}
	});

	// refresh command
	const refreshTreeViewCommand = vscode.commands.registerCommand('tagitup.refreshTreeView', () => {
		tagitupProvider.refresh();
		vscode.window.showInformationMessage('TagitUp refreshed.');
	});

	// removeActiveFileTag command
	const removeActiveFileTagCommand = vscode.commands.registerCommand('tagitup.removeActiveFileTag', async (tagToRemove: string) => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return; // No active editor
		}
		const fileUriString = editor.document.uri.toString();
		const currentTags = getFileTags(fileUriString, workspaceState);

		if (currentTags.length === 0) {
			vscode.window.showInformationMessage(`Active file has no tags to remove.`);
			return; // No tags to remove
		}

		const updatedTags = currentTags.filter(tag => tag !== tagToRemove); // Remove the specific tag
		const success = await setFileTags(fileUriString, updatedTags, workspaceState); 
		if (success) {
			vscode.window.showInformationMessage(`Tag "${tagToRemove}" removed from the active file.`);
			tagitupProvider.refresh(); // Refresh the tree view
		}
	});

	// searchByTags command
	const searchByTagsCommand = vscode.commands.registerCommand('tagitup.searchByTags', async () => {
		// prompt the user to input comma-separated tags.
		const input = await vscode.window.showInputBox({
			prompt: 'Enter tag query (e.g., "#heap & #graph", "#linked_list | #graph", "(#heap & #tree) | #array")',
			placeHolder: '#graph, #heap'
		});
		if (!input) {
			return;
		}

		let queryExpression: TagExpression;
		try {
			queryExpression = parseTagQuery(input);
		} catch (err) {
			vscode.window.showErrorMessage('Invalid tag query: ' + err);
			return;
		}

		// iterate over all files (keys from workspaceState) and filter
		const matchedItems: FileQuickPickItem[] = [];
		for (const fileUriString of workspaceState.keys()) {
			const fileTags = getFileTags(fileUriString, workspaceState);
			// check if any search tag exists in the file's tag list.
			// const hasAny = searchTags.some(searchTag => fileTags.includes(searchTag));
			if (queryExpression(fileTags)) {
				const fileUri = vscode.workspace.asRelativePath(vscode.Uri.parse(fileUriString));
				matchedItems.push({
					label: fileUri,
					description: fileTags.join(', '),
					fileUri: fileUriString
				});
			}
		}

		if (matchedItems.length === 0) {
			vscode.window.showInformationMessage('No files found with the specified tags.');
			return;
		}

		// Let the user select one of the matched files.
		const selected = await vscode.window.showQuickPick(matchedItems, {
			placeHolder: 'Select a file'
		});

		if (selected && selected.fileUri) {
			const fileUri = vscode.Uri.parse(selected.fileUri);
			vscode.window.showTextDocument(fileUri);
		}
	});


	context.subscriptions.push(tagFileCommand);
	context.subscriptions.push(clearWorkspaceStateCommand);
	context.subscriptions.push(refreshTreeViewCommand);
	context.subscriptions.push(removeActiveFileTagCommand);
	context.subscriptions.push(searchByTagsCommand);
}

/**
 * Gets the tags associated with a given file
 * @param filePath The absolute path of the current file
 * @param workspaceState VSCode's workspace state memento
 * @returns An array of tags associated with the file
 */
function getFileTags(filePath: string, workspaceState: vscode.Memento): string[] {
	const tags = workspaceState.get<string[]>(filePath);
	return tags || [];	// return empty array if no tags are found
}

/**
 * Sets tags to a given file
 * @param filePath The absolute path of the current file
 * @param tags The tags to be added to the file
 * @param workspaceState VSCode's workspace state memento
 * @returns boolean value stating whether the tags are set or not
 */
async function setFileTags(filePath: string, tags: string[], workspaceState: vscode.Memento): Promise<boolean> {
	// check for spaces in tags
	const invalidTags = tags.filter(tag => /\s/.test(tag));
	if (invalidTags.length > 0) {
		vscode.window.showErrorMessage(`Tags cannot contain spaces. Invalid tags: ${invalidTags.join(', ')}`);
		return false;
	}
	const uniqueTags = [...new Set(tags)];
	try {
		await workspaceState.update(filePath, uniqueTags);
		return true;
	}
	catch(reason) {
		vscode.window.showErrorMessage(`Failed to save tags for ${filePath}. Reason: ${reason}`);
		return false;
	};
}

/**
 * Clears tags associated with a given file (removes from workspaceState)
 * @param filePath The absolute path of the current file (URI string)
 * @param workspaceState VSCode's workspace state memento
 */
function clearFileTags(filePath: string, workspaceState: vscode.Memento) {
	workspaceState.update(filePath, undefined); // Set value to undefined to remove
}

/**
 * Cleans up the workspace state by removing entries for files that no longer exist.
 * This is useful to handle files deleted outside of VS Code.
 * @param workspaceState VSCode's workspace state memento
 */
async function cleanupWorkspaceState(workspaceState: vscode.Memento): Promise<void> {
	const allFilePaths = workspaceState.keys();	// get all the keys (file paths)

	for (const fileUriString of allFilePaths) {
		try {
			const fileUri = vscode.Uri.parse(fileUriString);
			await vscode.workspace.fs.stat(fileUri); // check if file exists. stat will throw error if not exist
		} catch (error: any) {
			if (error.code === 'FileNotFound' || error.code === 'ENOENT') {
				// File not found, remove from workspace state
				await workspaceState.update(fileUriString, undefined);
			}
		}
	}
}

/**
 * A data provider class to display the tags in the sidebar
 */
class TagitUpProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	constructor(private workspaceState: vscode.Memento) { }

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element;
	}

	getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
		if (element instanceof ActiveFileTagsItem) {
			// if an element is selected in the tree, show the children
			return Promise.resolve(this.getActiveFileTagItems(this.workspaceState));
		} else if (element && element.label === "Tags") {
			// list out all the tags under the "Tags" section
			return Promise.resolve(this.getTagCategoryItems(this.workspaceState));
		} else if (element instanceof TagCategoryItem) {
			// handle children for a TagCategoryItem (list files under this tag)
			return Promise.resolve(this.getFilesForTagItems(element.tagName, this.workspaceState));
		} else if (element) {
			return Promise.resolve([]);
		} else {
			// root of the tree
			return Promise.resolve(this.getRootTreeItems()); 	// top-level elements
		}
	}

	/**
	 * Get the tags of the current active text editor/file
	 * @param workspaceState VSCode's workspace state memento
	 * @returns List of tags of the active text edtior/file
	 */
	private getActiveFileTagItems(workspaceState: vscode.Memento): vscode.TreeItem[] {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return [];	// no active file
		}

		const fileUri = editor.document.uri.toString();
		const tags = getFileTags(fileUri, workspaceState);

		if (tags.length === 0) {
			return [new vscode.TreeItem("No tags found")];		// show the no tags message
		} else {
			return tags.map(tag => new ActiveFileTagItem(tag, workspaceState));	// show the tags
		}
	}

	/**
	 * Get all tag/category by getting each item 
	 * @param workspaceState VSCode's workspace state memento
	 * @returns 
	 */
	private getTagCategoryItems(workspaceState: vscode.Memento): vscode.TreeItem[] {
		const allFilePaths = workspaceState.keys();	// get all the keys (file paths)
		const uniqueTags = new Set<string>();

		for (const fileUri of allFilePaths) {
			const tagsForFile = getFileTags(fileUri, workspaceState);
			tagsForFile.forEach(tag => uniqueTags.add(tag));	// getting all the distinct tags
		}

		if (uniqueTags.size === 0) {
			return [new vscode.TreeItem('(No tags defined yet)')];
		} else {
			// returning a list of tagItems
			return Array.from(uniqueTags).map(tag => {
				// create TagCategoryItem instance for each tag
				return new TagCategoryItem(tag, workspaceState);
			});
		}
	}

	/**
	 * Get all the files for a specific tag
	 * @param tag A tag for which files have to be retrieved
	 * @param workspaceState VSCode's workspace state memento
	 * @returns List of files for the current tag
	 */
	private getFilesForTagItems(tag: string, workspaceState: vscode.Memento): vscode.TreeItem[] {
		const allFilePaths = workspaceState.keys();
		const fileItems: vscode.TreeItem[] = [];

		for (const fileUri of allFilePaths) {
			const tagsForFile = getFileTags(fileUri, workspaceState);
			if (tagsForFile.includes(tag)) {
				const relativePath = vscode.workspace.asRelativePath(fileUri);
				// create TaggedFileItem instance
				const fileItem = new TaggedFileItem(fileUri, relativePath);
				fileItems.push(fileItem);
			}
		}

		if (fileItems.length === 0) {
			return [new vscode.TreeItem('(No files with this tag)')];
		} else {
			return fileItems;
		}
	}

	/**
	 * Get the default root items of the activity bar
	 * @returns The root items of the tree view
	 */
	private getRootTreeItems(): vscode.TreeItem[] {
		const items: vscode.TreeItem[] = [];

		// 1. "Active File Tags" item where all the tags associate with the current file are listed
		const activeFileTagsItem = new ActiveFileTagsItem("Active File Tags", this.workspaceState);
		activeFileTagsItem.description = "Tags for the current file";
		activeFileTagsItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed; // expandable
		items.push(activeFileTagsItem);

		// 2. "Tags" item where all the tags are listed and under each tag,all the files tagged with the specific tag are listed
		const tagsItem = new vscode.TreeItem("Tags");
		tagsItem.description = "Files categorized by tags";
		tagsItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed; // expandable
		items.push(tagsItem);

		return items;
	}

	/**
	 * Refreshes the entire Tree View or a specific element (if provided).
	 * Call this method when you want to update the view's content.
	 * @param elementToRefresh (Optional) The element to refresh. If undefined, refreshes the entire tree.
	 */
	public refresh(elementToRefresh?: vscode.TreeItem): void {
		cleanupWorkspaceState(this.workspaceState).then(() => { // call cleanup before refreshing the tree
			this._onDidChangeTreeData.fire(elementToRefresh);
		});
	}
}

// This method is called when your extension is deactivated
export function deactivate() { }
