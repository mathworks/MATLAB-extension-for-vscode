// Copyright 2024-2025 The MathWorks, Inc.
import * as vscode from 'vscode';

import { blueBorderTopDecoration, blueBorderBottomDecoration, greyBorderTopDecoration, greyBorderBottomDecoration, fontWeightBoldDecoration } from './Decorations';
import { SectionModel, SectionsData, SectionData } from '../model/SectionModel'
import { Disposer } from '../commandwindow/Utilities';
import { StartAndEndLines, TopAndBottomRanges, StylingRanges } from './StylingInterfaces';
let previousFocusedEditor: vscode.TextEditor | undefined;

export class SectionStylingService extends Disposer {
    private readonly _sectionModel: SectionModel;

    constructor (sectionModel: SectionModel) {
        super();
        this._sectionModel = sectionModel;
    }

    initialize (): void {
        this._sectionModel.eventEmitter.on('onSectionsUpdated', this._postProcessSectionsData.bind(this));

        // Listen to cursor change to highlight the section
        this.own(vscode.window.onDidChangeTextEditorSelection((event) => this._handleTextEditorSelectionChange(event)));

        // Clear the active blue borders for focus out
        this.own(vscode.window.onDidChangeActiveTextEditor((editor) => this._handleEditorFocusChange(editor)))
        this.own(vscode.window.onDidChangeWindowState((windowFocusState) => this._handleWindowLostFocus(windowFocusState)));
    }

    private _postProcessSectionsData ({ sectionsData, editor }: { sectionsData: SectionsData, editor: vscode.TextEditor }): void {
        const { sectionRanges } = sectionsData;
        if (sectionRanges !== undefined && sectionRanges.length === 0) {
            // If there are no sections, clear the decorations
            this._clearDecorations(editor);
            return
        }
        const activeEditor = this._getActiveEditor();
        if (activeEditor !== undefined && activeEditor === editor) {
            const cursorPosition = editor.selection.active;
            if (cursorPosition !== undefined) {
                // Highlight active sections to blue and inactive sections to grey
                this._highlightSections(activeEditor, sectionsData, cursorPosition);
                return;
            }
        }
        // Highlight all sections to grey
        this._highlightSections(editor, sectionsData, null);
    }

    private _clearDecorations (editor: vscode.TextEditor): void {
        this._setDecorations(editor, { blue: { top: [], bottom: [] }, grey: { top: [], bottom: [] } }, []);
    }

    private _handleWindowLostFocus (windowState: vscode.WindowState): void {
        if (!windowState.focused) {
            const activeEditor = this._getActiveEditor();
            // Clear the blue borders when the window lost focus
            if (activeEditor != null) {
                this._clearBlueDecorations(activeEditor);
            }
        }
    }

    private _handleEditorFocusChange (editor: vscode.TextEditor | undefined): void {
        if (previousFocusedEditor !== undefined && previousFocusedEditor !== editor) {
            // Clear the blue borders for previous editors when new editor is focused
            this._clearBlueDecorations(previousFocusedEditor);
        }
        previousFocusedEditor = editor;
    }

    private _handleTextEditorSelectionChange (event: vscode.TextEditorSelectionChangeEvent): void {
        const editor = event.textEditor;
        const cursorPosition = editor.selection.active;
        const editorSections = this._sectionModel.getSectionsForFile(editor.document.uri);

        if (editorSections === undefined) {
            return;
        }

        if (editorSections.isDirty === true) {
            // Don't highlight sections if section creation is in progress
            // This will create sections with cache data which will be wrong
            return;
        }

        // Don't highlight sections if there is an error
        this._highlightSections(editor, editorSections, cursorPosition);
    }

    private _clearBlueDecorations (previousEditor: vscode.TextEditor): void {
        const sections = this._sectionModel.getSectionsForFile(previousEditor.document.uri);
        if (sections !== undefined && sections.isDirty === false) {
            this._highlightSections(previousEditor, sections, null);
        }
    }

    private _getActiveEditor (): vscode.TextEditor | undefined {
        return vscode.window.activeTextEditor;
    }

    /**
     * Highlights sections in the editor with grey lines if no cursor is present
     * Highlights active section (cursor present) in the editor with blue lines and others in grey line
     * Bold the first line of the sections
     */
    private _highlightSections (editor: vscode.TextEditor, sections: SectionsData, activeCursorPosition: vscode.Position | null): void {
        const startAndEndLines = this._sectionsToStartAndEndLines(sections.sectionRanges);
        const explicitStartAndEndLines = this._sectionsToStartAndEndLines(sections.sectionRanges.filter((section) => section.isExplicit));
        const explicitSectionRanges = this._generateRanges(explicitStartAndEndLines.startLines);
        const lastLineinSection = startAndEndLines.endLines.sort((a, b) => a - b)[startAndEndLines.endLines.length - 1];

        let stylingRanges: StylingRanges;
        if (activeCursorPosition !== null) {
            let cursorPositionLine = activeCursorPosition.line;
            if (cursorPositionLine > lastLineinSection) {
                cursorPositionLine = lastLineinSection
            }
            const focusedSection = this._findFocusedSection(sections, cursorPositionLine);
            if (focusedSection !== undefined) {
                stylingRanges = this._getBlueAndGreyRanges(startAndEndLines, focusedSection);
            } else {
                stylingRanges = { blue: { top: [], bottom: [] }, grey: this._getGreyRanges(startAndEndLines) };
            }
        } else {
            stylingRanges = { blue: { top: [], bottom: [] }, grey: this._getGreyRanges(startAndEndLines) };
        }
        this._filterFirstAndLastSection(stylingRanges, lastLineinSection, editor.document);

        this._setDecorations(editor, stylingRanges, explicitSectionRanges);
    }

    private _getBlueAndGreyRanges (startAndEndLines: StartAndEndLines, focusedSectionRange: SectionData): StylingRanges {
        const focusedStartLine = focusedSectionRange.range.start.line;
        const focusedEndLine = focusedSectionRange.range.end.line;
        const { startLines, endLines } = startAndEndLines;

        const startLinesWithoutFocusLine = startLines.filter((startLine) => {
            // Remove the start lines if the start is coinciding with
            // focus start or
            // start line is after the focused end line
            // so we can color them blue
            return !((startLine === focusedStartLine) || (startLine === (focusedEndLine + 1)));
        });

        const endLinesWithoutFocusLine = endLines.filter((endLine) => {
            // Remove the end lines if the end is coinciding with
            // focus end or
            // before the focus end line or
            // is it already part of the start lines
            return !(endLine === focusedEndLine ||
                endLine === (focusedStartLine - 1) ||
                startLines.includes(endLine + 1));
        });

        const blue: TopAndBottomRanges = { top: [], bottom: [] };

        const isTheEndLineAdjacentToStartLine = startLines.includes(focusedEndLine + 1)
        const topBordersToStyle = [focusedStartLine];
        const bottomLineNumbersToStyle = [];

        if (isTheEndLineAdjacentToStartLine) {
            // Style using top borders if the end line is adjacent to the start line
            topBordersToStyle.push(focusedEndLine + 1)
        } else {
            bottomLineNumbersToStyle.push(focusedEndLine)
        }
        blue.top = this._generateRanges(topBordersToStyle);
        blue.bottom = this._generateRanges(bottomLineNumbersToStyle);

        return {
            blue,
            grey: {
                top: this._generateRanges(startLinesWithoutFocusLine),
                bottom: this._generateRanges(endLinesWithoutFocusLine)
            }
        };
    }

    private _getGreyRanges (startAndEndLines: StartAndEndLines): TopAndBottomRanges {
        const { startLines, endLines } = startAndEndLines
        const endLinesFiltered = endLines.filter((endLine) => !startLines.includes(endLine + 1));
        return { top: this._generateRanges(startLines), bottom: this._generateRanges(endLinesFiltered) };
    }

    private _setDecorations (editor: vscode.TextEditor, stylingRange: StylingRanges, explicitSectionRanges: vscode.Range[]): void {
        editor.setDecorations(blueBorderTopDecoration, stylingRange.blue.top);
        editor.setDecorations(blueBorderBottomDecoration, stylingRange.blue.bottom);
        editor.setDecorations(greyBorderTopDecoration, stylingRange.grey.top);
        editor.setDecorations(greyBorderBottomDecoration, stylingRange.grey.bottom);
        editor.setDecorations(fontWeightBoldDecoration, explicitSectionRanges);
    }

    private _generateRanges (lines: number[]): vscode.Range[] {
        return lines.map((line: number) => new vscode.Range(line, 0, line, Infinity));
    }

    private _findFocusedSection (sections: SectionsData, lineNumber: number): SectionData | undefined {
        let activeSection: SectionData | undefined;
        if (lineNumber !== undefined && sections.sectionsTree !== undefined) {
            activeSection = sections.sectionsTree.find(lineNumber);
        }
        return activeSection;
    }

    private _sectionsToStartAndEndLines (sectionRanges: SectionData[]): StartAndEndLines {
        const startLines = new Set<number>();
        const endLines = new Set<number>();
        sectionRanges.forEach((sectionRange: SectionData) => {
            const startingIndex = sectionRange.range.start.line;
            const endingIndex = sectionRange.range.end.line;
            startLines.add(startingIndex);
            endLines.add(endingIndex);
        });
        return { startLines: Array.from(startLines), endLines: Array.from(endLines) };
    }

    private _filterFirstAndLastSection (stylingRanges: StylingRanges, endingLineOfSections: number, document: vscode.TextDocument): void {
        const filterByLineNumber = (lineNumber: number) => (position: vscode.Range): boolean => !(position.start.line === lineNumber);
        const startingLineOfDocument = 0;
        stylingRanges.blue.top = stylingRanges.blue.top.filter(filterByLineNumber(startingLineOfDocument));
        stylingRanges.grey.top = stylingRanges.grey.top.filter(filterByLineNumber(startingLineOfDocument));
        stylingRanges.blue.bottom = stylingRanges.blue.bottom.filter(filterByLineNumber(endingLineOfSections));
        stylingRanges.grey.bottom = stylingRanges.grey.bottom.filter(filterByLineNumber(endingLineOfSections));
    }
}

export default SectionStylingService;
