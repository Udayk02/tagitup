import * as vscode from 'vscode';

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
			tagitProvider.refresh();	// refresh
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

/**
 * A data provider class to display the tags in the sidebar
 */
class TagitProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	constructor(private workspaceState: vscode.Memento) {}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element;
	}

	getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
		if (element instanceof ActiveFileTagsItem) {
			// if an element is selected in the tree, show the children
			return Promise.resolve(this.getActiveFileTagItems(this.workspaceState));
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
	getActiveFileTagItems(workspaceState: vscode.Memento) : vscode.TreeItem[] {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return [];	// no active file
		} 

		const filePath = editor.document.uri.fsPath;
		const tags = getFileTags(filePath, workspaceState);

		if (tags.length === 0) {
			return [new vscode.TreeItem("No tags found")];		// show the no tags message
		} else {
			return tags.map(tag => new vscode.TreeItem(tag));	// show the tags
		}
	}

	/**
	 * Get the default root items of the activity bar
	 * @returns The root items of the tree view
	 */
	private getRootTreeItems() : vscode.TreeItem[] {
		const items: vscode.TreeItem[] = [];

		// 1. "Active File Tags" Item
        const activeFileTagsItem = new ActiveFileTagsItem("Active File Tags", this.workspaceState);
        activeFileTagsItem.description = "Tags for the current file";
        activeFileTagsItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed; // Make it expandable
        items.push(activeFileTagsItem);

        // 2. "All Tagged Files" Item
        const allTaggedFilesItem = new vscode.TreeItem("All Tagged Files");
        allTaggedFilesItem.description = "List of all files with tags";
        allTaggedFilesItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed; // Make it expandable
        items.push(allTaggedFilesItem);

        return items;
	}

	/**
     * Refreshes the entire Tree View or a specific element (if provided).
     * Call this method when you want to update the view's content.
     * @param elementToRefresh (Optional) The element to refresh. If undefined, refreshes the entire tree.
     */
    public refresh(elementToRefresh?: vscode.TreeItem): void {
        this._onDidChangeTreeData.fire(elementToRefresh);
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


// This method is called when your extension is deactivated
export function deactivate() {}
