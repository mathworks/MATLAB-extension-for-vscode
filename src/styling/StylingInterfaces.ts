// Copyright 2024-2025 The MathWorks, Inc.

import * as vscode from 'vscode';

interface StartAndEndLines {
    startLines: number[]
    endLines: number[]
}

interface TopAndBottomRanges { top: vscode.Range[], bottom: vscode.Range[] }

interface StylingRanges {blue: TopAndBottomRanges, grey: TopAndBottomRanges}
export { StartAndEndLines, TopAndBottomRanges, StylingRanges };
