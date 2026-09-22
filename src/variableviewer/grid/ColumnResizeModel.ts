// Copyright 2026 The MathWorks, Inc.

/** Captures the state at the start of a column resize drag operation. */
export interface ResizeDragState {
    /** 0-based index of the column being resized. */
    readonly colIndex: number
    /** Initial mouse clientX position when the drag began. */
    readonly startX: number
    /** Column width in pixels at drag start. */
    readonly startWidth: number
}

/**
 * Pure state machine for column resize interactions.
 * Tracks the active drag and computes new column widths from mouse movement.
 */
export class ColumnResizeModel {
    private drag: ResizeDragState | null = null

    /**
     * Begins a new column resize drag.
     * @param colIndex - 0-based index of the column being resized.
     * @param clientX - The mouse clientX position at drag start.
     * @param currentWidth - The column's current width in pixels.
     */
    beginDrag (colIndex: number, clientX: number, currentWidth: number): void {
        this.drag = { colIndex, startX: clientX, startWidth: currentWidth }
    }

    /**
     * Computes the new column width based on the current mouse position.
     * @param clientX - The current mouse clientX position.
     * @param minWidth - The minimum allowable column width in pixels.
     * @returns The computed new width, clamped to the minimum.
     */
    computeNewWidth (clientX: number, minWidth: number): number {
        if (this.drag == null) return minWidth
        const cursorDelta = clientX - this.drag.startX
        return Math.max(minWidth, this.drag.startWidth + cursorDelta)
    }

    /**
     * Returns the current drag state, or null if no drag is active.
     * @returns The active drag state or null.
     */
    getDrag (): ResizeDragState | null {
        return this.drag
    }

    /**
     * Ends the current drag and returns the column index that was being resized.
     * @returns The 0-based column index, or null if no drag was active.
     */
    endDrag (): number | null {
        if (this.drag == null) return null
        const colIndex = this.drag.colIndex
        this.drag = null
        return colIndex
    }

    /**
     * Tests whether a resize drag is currently active.
     * @returns True if a drag is in progress.
     */
    isDragging (): boolean {
        return this.drag != null
    }
}
