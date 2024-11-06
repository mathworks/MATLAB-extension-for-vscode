// Copyright 2024 The MathWorks, Inc.

import * as vscode from 'vscode';
import LineRangeTree from './LineRangeTree';

interface StartAndEndLines {
    startLines: number[]
    endLines: number[]
}

interface SectionsData {
    uri: string
    sectionRanges: vscode.Range[]
    sectionsTree: LineRangeTree | undefined
    isSectionCreationInProgress: boolean | undefined
    implictSectionAtStart: boolean | undefined
}

interface TopAndBottomRanges { top: vscode.Range[], bottom: vscode.Range[] }

interface StylingRanges {blue: TopAndBottomRanges, grey: TopAndBottomRanges}
export { StartAndEndLines, SectionsData, TopAndBottomRanges, StylingRanges };
