// Copyright 2024-2025 The MathWorks, Inc.
import * as vscode from 'vscode';

export interface SectionData {
    range: vscode.Range
    isExplicit: boolean
}

/**
 * A node used in the LineRangeTree.
 * @class TreeNode
 */
class TreeNode {
    range?: vscode.Range;
    section?: SectionData;
    children: TreeNode[];
    parent: TreeNode | undefined;
    constructor (section?: SectionData) {
        this.range = section?.range;
        this.children = [];
        this.parent = undefined;
        this.section = section;
    }

    add (treeNode: TreeNode): void {
        this.children.push(treeNode);
        treeNode.parent = this;
    }

    getStartLine (): number {
        if (this.range !== undefined) {
            return this.range.start.line;
        }
        return 0;
    }

    getEndLine (): number {
        if (this.range !== undefined) {
            return this.range.end.line;
        }

        return Infinity;
    }
}

export default class LineRangeTree {
    private _root: TreeNode | undefined;

    constructor (sectons: SectionData[]) {
        this._set(sectons);
    }

    /**
     * Creates a tree from the given section ranges array based on the start and end lines.
     */
    _set (sectonRanges: SectionData[]): void {
        this._root = new TreeNode(undefined);
        const objectLength = sectonRanges.length;
        let currentNode: TreeNode | undefined;
        currentNode = this._root;

        for (let i = 0; i < objectLength; i++) {
            const sectionRange = new TreeNode(sectonRanges[i]);

            while (currentNode != null) {
                if (sectionRange.getStartLine() >= currentNode.getStartLine() &&
                        sectionRange.getEndLine() <= currentNode.getEndLine()) {
                    currentNode.add(sectionRange);
                    currentNode = sectionRange;
                    break;
                } else {
                    currentNode = currentNode.parent;
                }
            }
        }
    }

    /**
     * Finds the object with smallest range (dfs) containing the given line number
     * @param line number
     * @returns Section Range
     */
    find (line: number): SectionData | undefined {
        let currentNode: TreeNode | undefined;

        currentNode = this._root;
        let lastNode = currentNode;

        while (currentNode != null) {
            currentNode = this._searchByLine(line, currentNode);
            lastNode = currentNode ?? lastNode;
        }
        return (lastNode != null) ? lastNode.section : undefined;
    }

    private _searchByLine (line: number, parentNode: TreeNode): TreeNode | undefined {
        const length = parentNode.children.length;
        if (length === 0) {
            return undefined;
        }

        let result: TreeNode | undefined;
        let start = 0;
        let end = length - 1;

        while (start <= end) {
            const mid = Math.floor((start + end) / 2);
            const midNode = parentNode.children[mid];
            const midNodeStartLine = midNode.getStartLine() ?? 0;
            if (line >= midNodeStartLine &&
                    line <= midNode.getEndLine()) {
                result = midNode;
                break;
            } else if (line < midNodeStartLine) {
                end = mid - 1;
            } else {
                start = mid + 1;
            }
        }

        return result;
    }
}
