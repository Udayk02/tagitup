import * as vscode from 'vscode';
import * as path from 'path';

/**
 * A class that represents "Active File Tags" item in the tree view
 */
export class ActiveFileTagsItem extends vscode.TreeItem {
	constructor(label: string, private workspaceState: vscode.Memento) {
		super(label, vscode.TreeItemCollapsibleState.Collapsed);
	}
}

/**
 * TreeItem for a tag under "Active File Tags" with inline remove action.
 */
export class ActiveFileTagItem extends vscode.TreeItem {
	constructor(
		public readonly tagName: string, // store the tag name
		private workspaceState: vscode.Memento
	) {
		super("", vscode.TreeItemCollapsibleState.None); // make it a non-collapsible item
		this.contextValue = 'activeFileTagItem';
		this.iconPath = new vscode.ThemeIcon('close');
		this.label = tagName;
		this.command = {
			command: 'tagitup.removeActiveFileTag',
			title: 'Remove Tag',
			arguments: [this.tagName]
		};
		this.tooltip = `Remove tag "${tagName}" from the active file`;
	}
}

/**
 * TreeItem for a tag/category in the "Tags" section.
 */
export class TagCategoryItem extends vscode.TreeItem {
	constructor(public readonly tagName: string, private workspaceState: vscode.Memento) {
		super(tagName, vscode.TreeItemCollapsibleState.Collapsed);
		this.contextValue = "tag";
	}
}

/**
 * TreeItem for a file listed under a tag/category in the "Tags" section.
 */
export class TaggedFileItem extends vscode.TreeItem {
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

/**
 * An item for the quick pick list of files to store fileuri explicitely
 */
export interface FileQuickPickItem extends vscode.QuickPickItem {
    fileUri: string;
}

