// Copyright 2026 The MathWorks, Inc.

import { ColumnWidthAdjustment, LabelInfo } from '../types'
import { GridConfig, DEFAULT_CONFIG } from './GridConfig'

/**
 * Manages column widths and pixel offsets for the virtual grid.
 * Supports initial auto-sizing from header labels, manual resize via setWidth,
 * and binary-search lookup of which column occupies a given scroll offset.
 */
export class ColumnLayout {
    private colWidths: number[] = []
    private colOffsets: number[] = []
    private totalWidth: number = 0
    private readonly adjustments: Map<number, number> = new Map()

    constructor (private readonly config: GridConfig = DEFAULT_CONFIG) {}

    /**
     * Computes initial column widths based on header label text length, applying a
     * minimum width floor. Rebuilds the offset and total-width caches.
     * @param numCols - Total number of columns in the variable.
     * @param columnLabels - Optional array of column label info for auto-sizing.
     */
    computeWidths (numCols: number, columnLabels?: readonly LabelInfo[]): void {
        this.colWidths = []
        this.colOffsets = []
        this.adjustments.clear()
        let offset = 0

        for (let c = 0; c < numCols; c++) {
            let width = this.config.minColWidth
            if (columnLabels != null && c < columnLabels.length) {
                const headerWidth = columnLabels[c].name.length * this.config.charWidth + this.config.headerPadding
                width = Math.max(this.config.minColWidth, headerWidth)
            }
            this.colWidths.push(width)
            this.colOffsets.push(offset)
            offset += width
        }
        this.totalWidth = offset
    }

    /**
     * Uses binary search to find the column index whose left edge is at or before the given pixel offset.
     * @param scrollX - Horizontal pixel offset to look up.
     * @returns The 0-based column index at that offset.
     */
    findColAtOffset (scrollX: number): number {
        if (this.colOffsets.length === 0) return 0
        let lo = 0
        let hi = this.colOffsets.length - 1
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1
            if (this.colOffsets[mid] <= scrollX) lo = mid
            else hi = mid - 1
        }
        return lo
    }

    /**
     * Returns the pixel width of the specified column.
     * @param col - 0-based column index.
     * @returns The column width in pixels.
     */
    getWidth (col: number): number {
        return this.colWidths[col] ?? this.config.minColWidth
    }

    /**
     * Returns the left-edge pixel offset of the specified column.
     * @param col - 0-based column index.
     * @returns The pixel offset from the left edge of the grid.
     */
    getOffset (col: number): number {
        return this.colOffsets[col] ?? 0
    }

    /**
     * Returns the total width of all columns combined.
     * @returns Total width in pixels.
     */
    getTotalWidth (): number {
        return this.totalWidth
    }

    /**
     * Returns the number of columns currently tracked.
     * @returns The column count.
     */
    getColumnCount (): number {
        return this.colWidths.length
    }

    /**
     * Sets the width of a specific column, clamped to the configured minimum.
     * Updates all subsequent column offsets and the total width accordingly.
     * @param col - 0-based column index to resize.
     * @param width - Desired new width in pixels (will be clamped to minimum).
     */
    setWidth (col: number, width: number): void {
        if (col < 0 || col >= this.colWidths.length) return
        const clamped = Math.max(this.config.minColWidth, width)
        this.adjustments.set(col, clamped)
        const delta = clamped - this.colWidths[col]
        if (delta === 0) return
        this.colWidths[col] = clamped
        for (let c = col + 1; c < this.colWidths.length; c++) {
            this.colOffsets[c] += delta
        }
        this.totalWidth += delta
    }

    /**
     * Returns the columns whose width was set via setWidth since the last computeWidths, ordered by position.
     * @returns The width adjustments keyed by 0-based column position.
     */
    getAdjustments (): ColumnWidthAdjustment[] {
        return [...this.adjustments.entries()]
            .sort(([a], [b]) => a - b)
            .map(([index, width]) => ({ index, width }))
    }

    /**
     * Re-applies previously recorded width adjustments. Adjustments for positions that no longer
     * exist are dropped by setWidth's bounds check, so they are not carried forward.
     * @param adjustments - Width adjustments keyed by 0-based column position.
     */
    applyAdjustments (adjustments: readonly ColumnWidthAdjustment[]): void {
        for (const { index, width } of adjustments) {
            this.setWidth(index, width)
        }
    }

    /**
     * Returns the configured minimum column width.
     * @returns Minimum width in pixels.
     */
    getMinWidth (): number {
        return this.config.minColWidth
    }
}
