import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "tagit" is now active!');

	const workspaceState = context.workspaceState;	// workspace state (kind of like a storage)

	const tagitProvider = new TagitProvider(workspaceState);
	// register the data provider
	vscode.window.registerTreeDataProvider('tagitTreeView', tagitProvider);
	// refresh the data provider so that tree view also gets refreshed
	// when the active editor changes
	vscode.window.onDidChangeActiveTextEditor(editor => {
		console.log("Active editor changed:", editor?.document.fileName);
		tagitProvider.refresh(); // call refresh on the TreeDataProvider to update the entire tree
	});

	// listen for file rename events, this is only applicable for renames withing the vs code workspace
	vscode.workspace.onDidRenameFiles(event => {
		console.log("Files renamed:", event.files.map(renamedFile => ({ old: renamedFile.oldUri.toString(), new: renamedFile.newUri.toString() })));
		event.files.forEach(renamedFile => {
			const oldFileUriString = renamedFile.oldUri.toString();
			const newFileUriString = renamedFile.newUri.toString();

			const tags = getFileTags(oldFileUriString, workspaceState); // get tags from old URI
			if (tags && tags.length > 0) {
				setFileTags(newFileUriString, tags, workspaceState);    // set tags for new URI
				clearFileTags(oldFileUriString, workspaceState);      // remove tags from old URI
				console.log(`Tags migrated from renamed file: ${oldFileUriString} to ${newFileUriString}`);
				tagitProvider.refresh(); // refresh tree view to update file paths
			} else {
				console.log(`No tags to migrate for renamed file: ${oldFileUriString}`);
			}
		});
	});

	// listen for the file deletions
	vscode.workspace.onDidDeleteFiles(event => {
		console.log("Files deleted:", event.files.map(deletedFile => deletedFile.toString()));
		event.files.forEach(deletedFile => {
			const deletedFileUriString = deletedFile.toString();
			clearFileTags(deletedFileUriString, workspaceState); // remove tags for the deleted file
			console.log(`Tags removed for deleted file: ${deletedFileUriString}`);
		});
		tagitProvider.refresh(); // refresh tree view to update file paths
	});

	vscode.window.onDidChangeWindowState(windowState => {
		if (windowState.focused) {
			console.log("VS Code window gained focus, refreshing Tagit view.");
			tagitProvider.refresh();
		}
	});

	// async tagFile command
	const tagFileCommand = vscode.commands.registerCommand('tagit.tagFile', async () => {
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
			prompt: `Enter tags (comma-separated)`,
			placeHolder: `e.g., #stack, #heap`,
			value: getFileTags(filePath, workspaceState).join(", ")	// pre fill the input box with existing tags
		});

		if (tagsInput) {
			const tags = tagsInput.split(",").map(tag => tag.trim());
			setFileTags(filePath, tags, workspaceState);			// store the tags into the workspace
			console.log(`File: ${filePath}, Tags: ${tags}`);

			vscode.window.showInformationMessage(`Tags added to the current file.`);
			tagitProvider.refresh();	// refresh
		} else {
			vscode.window.showInformationMessage(`Tagging cancelled.`);
		}
	});

	// clearWorkspaceState command
	const clearWorkspaceStateCommand = vscode.commands.registerCommand('tagit.clearWorkspaceState', async () => {
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

			vscode.window.showInformationMessage('Tagit workspace cleared.');
			tagitProvider.refresh(); // refresh the tree view
		} else {
			vscode.window.showInformationMessage('Clear workspace cancelled.');
		}
	});

	// refresh command
	const refreshTreeViewCommand = vscode.commands.registerCommand('tagit.refreshTreeView', () => {
		tagitProvider.refresh();
		vscode.window.showInformationMessage('Tagit refreshed.');
	});

	// removeActiveFileTag command
	const removeActiveFileTagCommand = vscode.commands.registerCommand('tagit.removeActiveFileTag', async (tagToRemove: string) => {
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
		setFileTags(fileUriString, updatedTags, workspaceState);
		console.log(`Tag "${tagToRemove}" removed from active file: ${fileUriString}`);
		vscode.window.showInformationMessage(`Tag "${tagToRemove}" removed from the active file.`);
		tagitProvider.refresh(); // Refresh the tree view
	});

	// searchByTags command
	const searchByTagsCommand = vscode.commands.registerCommand('tagit.searchByTags', async () => {
		let quickPick = vscode.window.createQuickPick();
		quickPick.title = 'Search Files by Tags';
		quickPick.placeholder = 'Enter tags to search (comma-separated, e.g., #feature, #bug)';
		quickPick.items = []; // initially empty results

		quickPick.onDidChangeValue(async (tagsInputValue) => {
			console.log("onDidChangeValue triggered. Input value:", tagsInputValue);
			// we need to filter the empty tags
			const searchTags = tagsInputValue.split(",").map(tag => tag.trim()).filter(tag => tag !== '');
			console.log("Search tags:", searchTags);
			if (searchTags.length === 0) {
				quickPick.items = []; // clear results if no tags entered
				console.log("No search tags, clearing QuickPick items.");
				return;
			}

			const allFilePaths = workspaceState.keys();
			console.log("All file paths in workspace state:", allFilePaths);
			const matchingFiles: vscode.QuickPickItem[] = [];

			for (const fileUriString of allFilePaths) {
				const fileTags = getFileTags(fileUriString, workspaceState);
				console.log(`File: ${fileUriString}, Tags: ${fileTags}`);
				const hasMatchingTag = searchTags.some(searchTag => fileTags.includes(searchTag));
				if (hasMatchingTag) {
					matchingFiles.push({
						label: vscode.workspace.asRelativePath(fileUriString), // relative path as label
						description: fileTags.join(', ') || '(No tags)' // tags as description
					});
				}
			}
			console.log("Matching files found:", matchingFiles);
			quickPick.items = matchingFiles; // update QuickPick items with search results
		});

		quickPick.onDidAccept(() => {
			const selectedItems = quickPick.selectedItems;
			if (selectedItems && selectedItems.length > 0) {
				const firstSelectedItem = selectedItems[0];
				const relativeFilePath = firstSelectedItem.label;	// relative path
				
				// current workspace thing, i don't need why this is handled like this
				const workspaceFolders = vscode.workspace.workspaceFolders;
				let workspaceFolderUri: vscode.Uri | undefined;
		
				if (workspaceFolders && workspaceFolders.length > 0) {
					workspaceFolderUri = workspaceFolders[0].uri;
				} else {
					vscode.window.showErrorMessage('No workspace folder open to open file.');
					quickPick.hide();
					return;
				}
		
				if (workspaceFolderUri) {
					const fileUri = vscode.Uri.joinPath(workspaceFolderUri, relativeFilePath);
		
					vscode.workspace.openTextDocument(fileUri).then(document => {
						vscode.window.showTextDocument(document);
					}, error => {
						vscode.window.showErrorMessage(`Error opening file: ${relativeFilePath}. ${error}`);
					});
				} else {
					vscode.window.showErrorMessage('Workspace folder URI is not available.');
				}
			}
			quickPick.hide();
		});

		quickPick.show();
	});
	
	context.subscriptions.push(tagFileCommand);
	context.subscriptions.push(clearWorkspaceStateCommand)
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
 */
function setFileTags(filePath: string, tags: string[], workspaceState: vscode.Memento) {
	const uniqueTags = [...new Set(tags)];
	workspaceState.update(filePath, uniqueTags).then(
		() => { /* success, do nothing. */ },
		(reason) => console.error("Failed to update tags for file:", filePath, reason)
	);
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
				console.log(`Removed stale file entry from workspace state: ${fileUriString}`);
			} else {
				// Other errors (e.g., permission issues), log them but don't remove
				console.error(`Error checking file existence for ${fileUriString}:`, error);
			}
		}
	}
}

/**
 * A data provider class to display the tags in the sidebar
 */
class TagitProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
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
		} else if (element && element.label == "Tags") {
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

/**
 * A class that represents "Active File Tags" item in the tree view
 */
class ActiveFileTagsItem extends vscode.TreeItem {
	constructor(label: string, private workspaceState: vscode.Memento) {
		super(label, vscode.TreeItemCollapsibleState.Collapsed);
	}
}

/**
 * TreeItem for a tag under "Active File Tags" with inline remove action.
 */
class ActiveFileTagItem extends vscode.TreeItem {
    constructor(
        public readonly tagName: string, // store the tag name
        private workspaceState: vscode.Memento
    ) {
        super("", vscode.TreeItemCollapsibleState.None); // make it a non-collapsible item
        this.contextValue = 'activeFileTagItem';
		this.iconPath = new vscode.ThemeIcon('close');
		this.label = tagName;
        this.command = {
            command: 'tagit.removeActiveFileTag',
            title: 'Remove Tag',
            arguments: [this.tagName]
        };
        this.tooltip = `Remove tag "${tagName}" from the active file`;
    }
}

/**
 * TreeItem for a tag/category in the "Tags" section.
 */
class TagCategoryItem extends vscode.TreeItem {
	constructor(public readonly tagName: string, private workspaceState: vscode.Memento) {
		super(tagName, vscode.TreeItemCollapsibleState.Collapsed);
		this.contextValue = "tag";
	}
}

/**
 * TreeItem for a file listed under a tag/category in the "Tags" section.
 */
class TaggedFileItem extends vscode.TreeItem {
	// both relativePath and filePath are needed
	// relativePath is for labelling the item and filePath is for looking for the tags
	constructor(public readonly fileUri: string, relativePath: string) {
		const filename = path.basename(relativePath);
		super(filename, vscode.TreeItemCollapsibleState.None); // label is the filename and the item is not expandable
		this.contextValue = 'taggedFileItem';
		this.resourceUri = vscode.Uri.parse(fileUri); // set resourceUri so that when clicked opens that file
		this.command = { // command to open file on click
			command: 'vscode.open',
			title: 'Open File',
			arguments: [this.resourceUri]
		};
	}
}


// This method is called when your extension is deactivated
export function deactivate() { }
