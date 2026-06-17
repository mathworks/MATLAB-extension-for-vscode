// Copyright 2026 The MathWorks, Inc.

// Maps MATLAB variable class names to their SVG icon filenames.
// Theme (dark/light) is determined at render time in the webview, not here.
const ICON_MAP: Record<string, string> = {
    object: 'ws3d.svg',
    cell: 'wsBrackets.svg',
    calendarduration: 'wsCalendar.svg',
    char: 'wsCharacter.svg',
    logical: 'wsCheck.svg',
    duration: 'wsClock.svg',
    datetime: 'wsDate.svg',
    default: 'wsDefault.svg',
    categorical: 'wsDots.svg',
    ordinal: 'wsDots.svg',
    nominal: 'wsDots.svg',
    sparse: 'wsSparse.svg',
    string: 'wsString.svg',
    table: 'wsTable.svg',
    dataset: 'wsTable.svg',
    timetable: 'wsTableTime.svg',
    eventtable: 'wsTableTime.svg',
    tall: 'wsTall.svg',
    timeseries: 'wsTime.svg',
    struct: 'wsTree.svg'
}

// All MATLAB numeric primitive types share the default numeric icon
const NUMERIC_TYPES: Set<string> = new Set([
    'double', 'single',
    'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64'
])

// Returns the SVG filename for a given MATLAB class name.
// Fallback order: direct match -> numeric type -> sparse-containing -> tall-containing -> object default
export function getIconFilename (matlabClass: string): string {
    const direct = ICON_MAP[matlabClass]
    if (direct != null) return direct

    if (NUMERIC_TYPES.has(matlabClass)) return 'wsDefault.svg'
    if (matlabClass.includes('sparse')) return 'wsSparse.svg'
    if (matlabClass.includes('tall')) return 'wsTall.svg'

    // Unknown types fall back to the generic object icon
    return 'ws3d.svg'
}
