// Copyright 2024-2026 The MathWorks, Inc.

import { Range } from 'vscode';

interface StartAndEndLines {
    startLines: number[]
    endLines: number[]
}

interface TopAndBottomRanges { top: Range[], bottom: Range[] }

interface StylingRanges { blue: TopAndBottomRanges, grey: TopAndBottomRanges }

export { StartAndEndLines, TopAndBottomRanges, StylingRanges }
