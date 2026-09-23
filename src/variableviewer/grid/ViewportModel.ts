// Copyright 2026 The MathWorks, Inc.

import { GridConfig, DEFAULT_CONFIG } from './GridConfig'
import { ColumnLayout } from './ColumnLayout'

/** A 0-based row/column range representing which cells are currently within a region. */
export interface ViewportRange {
    readonly startRow: number
    readonly endRow: number
    readonly startCol: number
    readonly endCol: number
}

/** Extends ViewportRange with the actual count of rows and columns to render from the pool. */
export interface RenderedRange extends ViewportRange {
    /** Number of pool rows that should be rendered (may be less than endRow-startRow+1 if pool is smaller). */
    readonly renderedRows: number
    /** Number of pool columns that should be rendered. */
    readonly renderedCols: number
}

/**
 * Computes which rows and columns are visible and which should be rendered (with overscan)
 * given the current scroll position, viewport dimensions, and column layout.
 */
export class ViewportModel {
    private numRows: number = 0
    private numCols: number = 0
    private visible: ViewportRange = { startRow: 0, endRow: 0, startCol: 0, endCol: 0 }
    private rendered: RenderedRange = { startRow: 0, endRow: 0, startCol: 0, endCol: 0, renderedRows: 0, renderedCols: 0 }

    constructor (private readonly config: GridConfig = DEFAULT_CONFIG) {}

    /**
     * Sets the total grid dimensions. Must be called when variable metadata changes.
     * @param numRows - Total number of data rows.
     * @param numCols - Total number of data columns.
     */
    setDimensions (numRows: number, numCols: number): void {
        this.numRows = numRows
        this.numCols = numCols
    }

    /**
     * Returns the total grid dimensions as a tuple.
     * @returns A [rows, cols] tuple.
     */
    getDimensions (): [number, number] {
        return [this.numRows, this.numCols]
    }

    /**
     * Recomputes the visible and rendered ranges based on the current scroll state.
     * The rendered range extends beyond the visible range by the configured overscan amount,
     * clamped to pool capacity and grid dimensions.
     * @param scrollTop - Vertical scroll offset in pixels.
     * @param scrollLeft - Horizontal scroll offset in pixels.
     * @param viewHeight - Viewport height in pixels.
     * @param viewWidth - Viewport width in pixels.
     * @param columnLayout - The current column layout for offset-to-column mapping.
     * @param poolRows - Maximum number of row nodes available in the DOM pool.
     * @param poolCols - Maximum number of column nodes available in the DOM pool.
     */
    update (scrollTop: number, scrollLeft: number, viewHeight: number, viewWidth: number, columnLayout: ColumnLayout, poolRows: number, poolCols: number): void {
        const contentScrollRight = scrollLeft + viewWidth

        const visStartRow = Math.max(0, Math.floor(scrollTop / this.config.rowHeight))
        const visEndRow = Math.min(this.numRows - 1, Math.ceil((scrollTop + viewHeight) / this.config.rowHeight))
        const visStartCol = Math.max(0, columnLayout.findColAtOffset(scrollLeft))
        const visEndCol = Math.min(this.numCols - 1, columnLayout.findColAtOffset(contentScrollRight))

        this.visible = { startRow: visStartRow, endRow: visEndRow, startCol: visStartCol, endCol: visEndCol }

        const startRow = Math.max(0, visStartRow - this.config.overscanRows)
        const endRow = Math.min(this.numRows - 1, visEndRow + this.config.overscanRows)
        const startCol = Math.max(0, visStartCol - this.config.overscanCols)
        const endCol = Math.min(this.numCols - 1, visEndCol + this.config.overscanCols)

        const renderedRows = Math.min(endRow - startRow + 1, poolRows)
        const renderedCols = Math.min(endCol - startCol + 1, poolCols)

        this.rendered = { startRow, endRow, startCol, endCol, renderedRows, renderedCols }
    }

    /**
     * Returns the last computed visible range (cells fully or partially within the viewport).
     * @returns The visible viewport range.
     */
    getVisibleRange (): ViewportRange {
        return this.visible
    }

    /**
     * Returns the last computed rendered range (visible + overscan, clamped to pool size).
     * @returns The rendered range with row/col counts.
     */
    getRenderedRange (): RenderedRange {
        return this.rendered
    }

    /**
     * Computes a visible range from scroll parameters without updating internal state.
     * Used by the chunk cache to determine which data chunks are needed.
     * @param scrollTop - Vertical scroll offset in pixels.
     * @param scrollLeft - Horizontal scroll offset in pixels.
     * @param viewHeight - Viewport height in pixels.
     * @param viewWidth - Viewport width in pixels.
     * @param columnLayout - The current column layout for offset-to-column mapping.
     * @returns The computed visible range.
     */
    computeVisibleRangeFromScroll (scrollTop: number, scrollLeft: number, viewHeight: number, viewWidth: number, columnLayout: ColumnLayout): ViewportRange {
        const contentScrollRight = scrollLeft + viewWidth

        const startRow = Math.max(0, Math.floor(scrollTop / this.config.rowHeight))
        const endRow = Math.max(0, Math.ceil((scrollTop + viewHeight) / this.config.rowHeight))
        const startCol = Math.max(0, columnLayout.findColAtOffset(scrollLeft))
        const endCol = Math.max(0, columnLayout.findColAtOffset(contentScrollRight))

        return { startRow, endRow, startCol, endCol }
    }
}
