// Copyright 2026 The MathWorks, Inc.

import { CellCoord } from './SelectionModel'

/** Computes the target cell for keyboard navigation within grid bounds. */
export class NavigationModel {
    private pageSize: number = 20

    setPageSize (size: number): void {
        this.pageSize = size
    }

    /**
     * Computes the new cell coordinate after a key press, clamped to grid boundaries.
     * @param key - The keyboard event key string (e.g. 'ArrowDown', 'Home', 'PageDown').
     * @param currentCell - The currently selected cell coordinate (1-based).
     * @param gridDimensions - Tuple of [totalRows, totalCols] defining the grid bounds.
     * @param ctrlKey - Whether Ctrl (or Cmd on macOS) is held.
     * @returns The new cell coordinate to navigate to, or null if the key is unrecognized or movement is at a boundary.
     */
    computeMove (key: string, currentCell: CellCoord, gridDimensions: [number, number], ctrlKey: boolean): CellCoord | null {
        const [numRows, numCols] = gridDimensions
        let { row, col } = currentCell

        switch (key) {
            case 'ArrowDown':
                if (ctrlKey) { row = numRows } else if (row < numRows) { row++ }
                break
            case 'ArrowUp':
                if (ctrlKey) { row = 1 } else if (row > 1) { row-- }
                break
            case 'ArrowRight':
                if (ctrlKey) { col = numCols } else if (col < numCols) { col++ }
                break
            case 'ArrowLeft':
                if (ctrlKey) { col = 1 } else if (col > 1) { col-- }
                break
            case 'Home':
                if (ctrlKey) { row = 1; col = 1 } else { col = 1 }
                break
            case 'End':
                if (ctrlKey) { row = numRows; col = numCols } else { col = numCols }
                break
            case 'PageDown':
                row = Math.min(numRows, row + this.pageSize)
                break
            case 'PageUp':
                row = Math.max(1, row - this.pageSize)
                break
            default:
                return null
        }

        if (row === currentCell.row && col === currentCell.col) return null
        return { row, col }
    }
}
