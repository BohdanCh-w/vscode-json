import * as vscode from 'vscode';
import * as json from 'jsonc-parser';
import * as path from 'path';
import { parseDocument, isMap, isSeq, Pair } from 'yaml';

type TreeNodeType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

interface TreeNode {
	offset: number;
	length: number;
	type: TreeNodeType;
	value?: any;
	parent?: TreeNode;
	children?: TreeNode[];
	key?: string | number;
	keyOffset?: number;
	keyLength?: number;
}

export class JsonTreeProvider implements vscode.TreeDataProvider<number> {

	private _onDidChangeTreeData: vscode.EventEmitter<number | undefined> = new vscode.EventEmitter<number | undefined>();
	readonly onDidChangeTreeData: vscode.Event<number | undefined> = this._onDidChangeTreeData.event;

	private tree: TreeNode | undefined;
	private text = '';
	private editor: vscode.TextEditor | undefined;
	private autoRefresh = true;
	private languageId: string | undefined;
	private nodeMap: Map<number, TreeNode> = new Map();

	constructor(private context: vscode.ExtensionContext) {
		vscode.window.onDidChangeActiveTextEditor(() => this.onActiveEditorChanged());
		vscode.workspace.onDidChangeTextDocument(e => this.onDocumentChanged(e));
		this.parseTree();
		this.autoRefresh = vscode.workspace.getConfiguration('JSON-zain.json').get('autorefresh', false);
		vscode.workspace.onDidChangeConfiguration(() => {
			this.autoRefresh = vscode.workspace.getConfiguration('JSON-zain.json').get('autorefresh', false);
		});
		this.onActiveEditorChanged();
	}

	refresh(offset?: number): void {
		this.parseTree();
		if (offset) {
			this._onDidChangeTreeData.fire(offset);
		} else {
			this._onDidChangeTreeData.fire(undefined);
		}
	}

	rename(offset: number): void {
		vscode.window.showInputBox({ placeHolder: 'Enter the new label' })
			.then(value => {
				const editor = this.editor;
				const targetNode = this.nodeMap.get(offset);
				if (value !== null && value !== undefined && editor && this.tree && targetNode) {
					if (targetNode.parent?.type === 'array' || targetNode.keyOffset === undefined || targetNode.keyLength === undefined) {
						return;
					}
					editor.edit(editBuilder => {
						const range = new vscode.Range(editor.document.positionAt(targetNode.keyOffset), editor.document.positionAt(targetNode.keyOffset + targetNode.keyLength));
						const replacement = this.isYamlLanguage() ? this.formatYamlKey(value, targetNode) : JSON.stringify(value);
						editBuilder.replace(range, replacement);
						setTimeout(() => {
							this.parseTree();
							this.refresh(offset);
						}, 100);
					});
				}
			});
	}

	private onActiveEditorChanged(): void {
		if (vscode.window.activeTextEditor) {
			if (vscode.window.activeTextEditor.document.uri.scheme === 'file') {
				const languageId = vscode.window.activeTextEditor.document.languageId;
				const enabled = languageId === 'json' || languageId === 'jsonc' || languageId === 'yaml';
				vscode.commands.executeCommand('setContext', 'jsonTreeEnabled', enabled);
			}
		} else {
			vscode.commands.executeCommand('setContext', 'jsonTreeEnabled', false);
		}
		this.refresh();
	}

	private onDocumentChanged(changeEvent: vscode.TextDocumentChangeEvent): void {
		if (this.tree && this.autoRefresh && changeEvent.document.uri.toString() === this.editor?.document.uri.toString()) {
			this.parseTree();
			this._onDidChangeTreeData.fire(undefined);
		}
	}

	private parseTree(): void {
		this.text = '';
		this.tree = undefined;
		this.languageId = undefined;
		this.nodeMap.clear();
		this.editor = vscode.window.activeTextEditor;
		if (this.editor && this.editor.document) {
			this.text = this.editor.document.getText();
			this.languageId = this.editor.document.languageId;
			if (this.isYamlLanguage()) {
				this.tree = this.parseYamlTree();
			} else {
				const parsedJson = json.parseTree(this.text);
				this.tree = parsedJson ? this.buildJsonTree(parsedJson, undefined) : undefined;
			}
		}
	}

	getChildren(offset?: number): Thenable<number[]> {
		if (offset && this.tree) {
			const node = this.nodeMap.get(offset);
			return Promise.resolve(node ? this.getChildrenOffsets(node) : []);
		} else {
			return Promise.resolve(this.tree ? this.getChildrenOffsets(this.tree) : []);
		}
	}

	private getChildrenOffsets(node: TreeNode): number[] {
		const offsets: number[] = [];
		if (node.children) {
			for (const child of node.children) {
				offsets.push(child.offset);
			}
		}
		return offsets;
	}

	getTreeItem(offset: number): vscode.TreeItem {
		if (!this.tree) {
			throw new Error('Invalid tree');
		}
		if (!this.editor) {
			throw new Error('Invalid editor');
		}

		const valueNode = this.nodeMap.get(offset);
		if (valueNode) {
			const hasChildren = valueNode.type === 'object' || valueNode.type === 'array';
			const treeItem: vscode.TreeItem = new vscode.TreeItem(this.getLabel(valueNode), hasChildren ? valueNode.type === 'object' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
			treeItem.command = {
				command: 'extension.openJsonSelection',
				title: '',
				arguments: [new vscode.Range(this.editor.document.positionAt(valueNode.offset), this.editor.document.positionAt(valueNode.offset + valueNode.length))]
			};
			treeItem.iconPath = this.getIcon(valueNode);
			treeItem.contextValue = valueNode.type;
			return treeItem;
		}
		throw (new Error(`Could not find node at ${offset}`));
	}

	select(range: vscode.Range) {
		if (this.editor) {
			this.editor.selection = new vscode.Selection(range.start, range.end);
			this.editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
		}
	}

	private getIcon(node: TreeNode): any {
		const nodeType = node.type;
		if (nodeType === 'boolean') {
			return {
				light: this.context.asAbsolutePath(path.join('resources', 'light', 'boolean.svg')),
				dark: this.context.asAbsolutePath(path.join('resources', 'dark', 'boolean.svg'))
			};
		}
		if (nodeType === 'string') {
			return {
				light: this.context.asAbsolutePath(path.join('resources', 'light', 'string.svg')),
				dark: this.context.asAbsolutePath(path.join('resources', 'dark', 'string.svg'))
			};
		}
		if (nodeType === 'number') {
			return {
				light: this.context.asAbsolutePath(path.join('resources', 'light', 'number.svg')),
				dark: this.context.asAbsolutePath(path.join('resources', 'dark', 'number.svg'))
			};
		}
		return null;
	}

	private getLabel(node: TreeNode): string {
		if (node.parent?.type === 'array') {
			const prefix = node.parent.children ? node.parent.children.indexOf(node).toString() : (node.key?.toString() ?? '');
			if (node.type === 'object') {
				return prefix + ': { '+ this.getNodeChildrenCount(node) +' }';
			}
			if (node.type === 'array') {
				return prefix + ': [ '+ this.getNodeChildrenCount(node) +' ]';
			}
			const value = this.editor?.document.getText(new vscode.Range(this.editor.document.positionAt(node.offset), this.editor.document.positionAt(node.offset + node.length)));
			return `${prefix}:${value}`;
		}
		else {
			const property = node.key !== undefined ? node.key.toString() : '';
			if (node.type === 'array' || node.type === 'object') {
				if (node.type === 'object') {
					return '{ '+ this.getNodeChildrenCount(node) +' } ' + property;
				}
				if (node.type === 'array') {
					return '[ '+ this.getNodeChildrenCount(node) +' ] ' + property;
				}
			}
			const value = this.editor?.document.getText(new vscode.Range(this.editor.document.positionAt(node.offset), this.editor.document.positionAt(node.offset + node.length)));
			return `${property}: ${value}`;
		}
	}

	private getNodeChildrenCount(node: TreeNode): string {
		let count = '';
		if (node && node.children) {
			count = node.children.length + '';
		}
		return count;
	}

	private isYamlLanguage(): boolean {
		return this.languageId === 'yaml';
	}

	private buildJsonTree(node: json.Node, parent?: TreeNode, key?: string | number): TreeNode | undefined {
		if (!node) {
			return undefined;
		}
		if (node.type === 'property' && node.children?.length) {
			const keyNode = node.children[0];
			const valueNode = node.children[1];
			if (!keyNode || !valueNode) {
				return undefined;
			}
			const propertyName = keyNode.value as string;
			const child = this.buildJsonTree(valueNode, parent, propertyName);
			if (child) {
				child.keyOffset = keyNode.offset;
				child.keyLength = keyNode.length;
			}
			return child;
		}
		const normalizedType = this.normalizeNodeType(node.type);
		const current: TreeNode = {
			offset: node.offset,
			length: node.length,
			type: normalizedType,
			value: node.value,
			parent,
			key,
			children: []
		};
		this.nodeMap.set(current.offset, current);
		if (node.children) {
			if (node.type === 'object') {
				for (const child of node.children) {
					const builtChild = this.buildJsonTree(child, current);
					if (builtChild) {
						current.children?.push(builtChild);
					}
				}
			} else if (node.type === 'array') {
				node.children.forEach((childNode, index) => {
					const builtChild = this.buildJsonTree(childNode, current, index);
					if (builtChild) {
						current.children?.push(builtChild);
					}
				});
			}
		}
		return current;
	}

	private parseYamlTree(): TreeNode | undefined {
		try {
			const doc = parseDocument(this.text, { prettyErrors: false, keepCstNodes: true });
			if (!doc || !doc.contents) {
				return undefined;
			}
			return this.buildYamlTree(doc.contents as any, undefined);
		} catch {
			return undefined;
		}
	}

	private buildYamlTree(node: any, parent?: TreeNode, key?: string | number): TreeNode | undefined {
		const range = this.getYamlRange(node);
		if (!range) {
			return undefined;
		}
		const nodeType = this.getYamlNodeType(node);
		const current: TreeNode = {
			offset: range.start,
			length: range.end - range.start,
			type: nodeType,
			value: this.getYamlValue(node),
			parent,
			key,
			children: []
		};
		this.nodeMap.set(current.offset, current);

		if (isMap(node) && Array.isArray(node.items)) {
			for (const pair of node.items as Pair[]) {
				const childKey = this.getYamlPairKey(pair);
				if (pair.value) {
					const childNode = this.buildYamlTree(pair.value, current, childKey);
					if (childNode) {
						const keyRange = this.getYamlRange(pair.key || pair);
						if (keyRange) {
							childNode.keyOffset = keyRange.start;
							childNode.keyLength = keyRange.end - keyRange.start;
						}
						current.children?.push(childNode);
					}
				} else {
					const keyRange = this.getYamlRange(pair.key || pair);
					const nullOffset = keyRange ? keyRange.end : current.offset;
					const nullNode: TreeNode = {
						offset: nullOffset,
						length: 0,
						type: 'null',
						parent: current,
						key: childKey,
						children: []
					};
					nullNode.keyOffset = keyRange?.start;
					nullNode.keyLength = keyRange ? keyRange.end - keyRange.start : 0;
					this.nodeMap.set(nullNode.offset, nullNode);
					current.children?.push(nullNode);
				}
			}
		} else if (isSeq(node) && Array.isArray(node.items)) {
			node.items.forEach((item: any, index: number) => {
				const builtChild = this.buildYamlTree(item, current, index);
				if (builtChild) {
					current.children?.push(builtChild);
				}
			});
		}
		return current;
	}

	private getYamlRange(node: any): { start: number; end: number } | undefined {
		if (!node) {
			return undefined;
		}
		if (Array.isArray(node.range) && typeof node.range[0] === 'number') {
			const start = node.range[0];
			const endCandidate = typeof node.range[1] === 'number' ? node.range[1] : undefined;
			const end = typeof endCandidate === 'number' ? endCandidate : node.range[2];
			if (typeof end === 'number') {
				return { start, end };
			}
		}
		if (node.range && typeof node.range.start === 'number' && typeof node.range.end === 'number') {
			return { start: node.range.start, end: node.range.end };
		}
		return undefined;
	}

	private getYamlNodeType(node: any): TreeNodeType {
		if (isMap(node)) {
			return 'object';
		}
		if (isSeq(node)) {
			return 'array';
		}
		const value = this.getYamlValue(node);
		if (typeof value === 'string') {
			return 'string';
		}
		if (typeof value === 'number') {
			return 'number';
		}
		if (typeof value === 'boolean') {
			return 'boolean';
		}
		return 'null';
	}

	private getYamlValue(node: any): any {
		if (node && typeof node.value !== 'undefined') {
			return node.value;
		}
		if (node && typeof node.toJSON === 'function') {
			return node.toJSON();
		}
		return null;
	}

	private getYamlPairKey(pair: Pair): string | number | undefined {
		if (!pair || !pair.key) {
			return undefined;
		}
		if (typeof (pair.key as any).value !== 'undefined') {
			return (pair.key as any).value;
		}
		if (typeof (pair.key as any).toJSON === 'function') {
			return (pair.key as any).toJSON();
		}
		return pair.key.toString();
	}

	private normalizeNodeType(type: string): TreeNodeType {
		switch (type) {
			case 'object':
				return 'object';
			case 'array':
				return 'array';
			case 'number':
				return 'number';
			case 'boolean':
				return 'boolean';
			case 'string':
				return 'string';
			case 'null':
				return 'null';
			default:
				return 'string';
		}
	}

	private formatYamlKey(value: string, node: TreeNode): string {
		if (node.keyOffset === undefined || node.keyLength === undefined) {
			return value;
		}
		const existing = this.text.slice(node.keyOffset, node.keyOffset + node.keyLength);
		const trimmed = existing.trim();
		if (trimmed.startsWith('"') || trimmed.startsWith('\'')) {
			const quote = trimmed[0];
			return `${quote}${value}${quote}`;
		}
		return value;
	}
}
