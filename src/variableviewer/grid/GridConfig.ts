// Copyright 2026 The MathWorks, Inc.

/** Tunable parameters that control the virtual grid's layout, chunking, and scrolling behavior. */
export interface GridConfig {
    /** Number of rows per data chunk fetched from the server. */
    readonly chunkRows: number
    /** Number of columns per data chunk fetched from the server. */
    readonly chunkCols: number
    /** Maximum age in milliseconds before a pending chunk request is considered stale. */
    readonly chunkTimeoutMs: number
    /** Delay in milliseconds after scroll stops before requesting new data chunks. */
    readonly scrollDebounceMs: number
    /** Height in pixels of each data row. */
    readonly rowHeight: number
    /** Minimum column width in pixels, used for initial sizing and as a floor during resize. */
    readonly minColWidth: number
    /** Estimated width in pixels of a single character, used for auto-sizing columns. */
    readonly charWidth: number
    /** Extra horizontal padding in pixels added when auto-sizing column headers. */
    readonly headerPadding: number
    /** Fixed width in pixels of the row header gutter. */
    readonly rowHeaderWidth: number
    /** Fixed height in pixels of the column header bar. */
    readonly colHeaderHeight: number
    /** Number of extra rows rendered above and below the visible viewport. */
    readonly overscanRows: number
    /** Number of extra columns rendered left and right of the visible viewport. */
    readonly overscanCols: number
    /** Maximum number of cached data chunks before LRU eviction begins. */
    readonly maxChunks: number
    /** Extra horizontal padding in pixels added to the grid spacer to allow overscroll. */
    readonly scrollPadding: number
}

/** Default grid configuration values used across all Variable Viewer grid instances. */
export const DEFAULT_CONFIG: GridConfig = {
    chunkRows: 50,
    chunkCols: 20,
    chunkTimeoutMs: 10000,
    scrollDebounceMs: 100,
    rowHeight: 24,
    minColWidth: 80,
    charWidth: 8,
    headerPadding: 16,
    rowHeaderWidth: 60,
    colHeaderHeight: 24,
    overscanRows: 5,
    overscanCols: 5,
    maxChunks: 64,
    scrollPadding: 40
}
