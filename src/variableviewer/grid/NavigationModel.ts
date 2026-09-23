// Copyright 2026 The MathWorks, Inc.

import { CellCoord } from './SelectionModel'

/** Computes the target cell for arrow-key navigation within grid bounds. */
export class NavigationModel {
    /**
     * Computes the new cell coordinate after an arrow key press, clamped to grid boundaries.
     * @param key - The keyboard event key string (e.g. 'ArrowDown', 'ArrowUp').
     * @param currentCell - The currently selected cell coordinate (1-based).
     * @param gridDimensions - Tuple of [totalRows, totalCols] defining the grid bounds.
     * @returns The new cell coordinate to navigate to, or null if the key is unrecognized or movement is at a boundary.
     */
    computeMove (key: string, currentCell: CellCoord, gridDimensions: [number, number]): CellCoord | null {
        const [numRows, numCols] = gridDimensions
        let { row, col } = currentCell

        switch (key) {
            case 'ArrowDown':
                if (row < numRows) row++
                break
            case 'ArrowUp':
                if (row > 1) row--
                break
            case 'ArrowRight':
                if (col < numCols) col++
                break
            case 'ArrowLeft':
                if (col > 1) col--
                break
            default:
                return null
        }

        if (row === currentCell.row && col === currentCell.col) return null
        return { row, col }
    }
}
