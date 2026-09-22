// Copyright 2026 The MathWorks, Inc.

/** A 1-based row and column coordinate identifying a single cell in the grid. */
export interface CellCoord {
    readonly row: number
    readonly col: number
}

/**
 * Tracks the single currently-selected cell in the grid.
 * Coordinates are 1-based to match MATLAB indexing conventions.
 */
export class SelectionModel {
    private selectedCell: CellCoord | null = null

    /**
     * Sets the selected cell to the given coordinate.
     * @param row - 1-based row index.
     * @param col - 1-based column index.
     */
    select (row: number, col: number): void {
        this.selectedCell = { row, col }
    }

    /** Clears the current selection so no cell is selected. */
    clear (): void {
        this.selectedCell = null
    }

    /**
     * Tests whether a given cell is the currently selected cell.
     * @param row - 1-based row index to test.
     * @param col - 1-based column index to test.
     * @returns True if the cell at (row, col) is selected.
     */
    isSelected (row: number, col: number): boolean {
        return this.selectedCell != null && this.selectedCell.row === row && this.selectedCell.col === col
    }

    /**
     * Returns the currently selected cell coordinate, or null if nothing is selected.
     * @returns The selected cell coordinate or null.
     */
    getSelected (): CellCoord | null {
        return this.selectedCell
    }
}
