// Copyright 2026 The MathWorks, Inc.

import { GridConfig } from './GridConfig'
import { ColumnLayout } from './ColumnLayout'
import { RenderedRange } from './ViewportModel'
import { ChunkCache } from './ChunkCache'
import { SelectionModel } from './SelectionModel'
import { VariableColumns, VariableRows } from '../types'

/** References to the top-level structural DOM elements that form the grid layout. */
export interface GridScaffold {
    readonly gridWrap: HTMLElement
    readonly viewport: HTMLElement
    readonly colHeaderBar: HTMLElement
    readonly rowHeaderCol: HTMLElement
    readonly corner: HTMLElement
    readonly spacer: HTMLElement
    readonly gridOuter: HTMLElement
}

/** The pre-allocated pool of reusable DOM nodes for the virtual-scrolling grid. */
export interface CellPool {
    /** Number of row nodes in the pool. */
    readonly poolRows: number
    /** Number of cell nodes per row in the pool. */
    readonly poolCols: number
    /** Pre-allocated row container divs. */
    readonly rowDivs: HTMLDivElement[]
    /** 2-D array of pre-allocated cell divs, indexed by [poolRow][poolCol]. */
    readonly cells: HTMLDivElement[][]
    /** Pre-allocated column header divs. */
    readonly colHeaders: HTMLDivElement[]
    /** Span elements inside each column header for label text. */
    readonly colHeaderLabels: HTMLSpanElement[]
    /** Pre-allocated row header divs. */
    readonly rowHeaders: HTMLDivElement[]
    /** Container div holding all column header nodes. */
    readonly colHeaderContainer: HTMLDivElement
    /** Container div holding all row header nodes. */
    readonly rowHeaderContainer: HTMLDivElement
}

/**
 * Creates and manages the pre-allocated DOM node pool for the virtual-scrolling grid.
 * On each render pass, pool nodes are recycled by updating their attributes, classes,
 * and text content in place rather than creating or destroying DOM elements.
 */
export class GridDomPool {
    private lastViewportLeft: number = 0
    private lastViewportTop: number = 0

    constructor (private readonly config: GridConfig) {}

    /**
     * Initializes the structural scaffold of the grid: clears existing content, sets ARIA
     * grid attributes, applies CSS custom properties, and creates the spacer and viewport elements.
     * @param gridOuter - The outermost grid container element.
     * @param gridWrap - The scrollable wrapper element.
     * @param colHeaderBar - Container for column headers.
     * @param rowHeaderCol - Container for row headers.
     * @param corner - The top-left corner element.
     * @param numRows - Total number of data rows in the variable.
     * @param numCols - Total number of data columns in the variable.
     * @param columnLayout - The current column layout for computing total width.
     * @param dataType - The MATLAB data type, stored as a data attribute for CSS targeting.
     * @returns The initialized scaffold containing references to all structural elements.
     */
    createScaffold (gridOuter: HTMLElement, gridWrap: HTMLElement, colHeaderBar: HTMLElement, rowHeaderCol: HTMLElement, corner: HTMLElement, numRows: number, numCols: number, columnLayout: ColumnLayout, dataType: string): GridScaffold {
        const totalHeight = numRows * this.config.rowHeight
        const totalWidth = columnLayout.getTotalWidth() + this.config.scrollPadding

        gridWrap.innerHTML = ''
        gridOuter.dataset.dtype = dataType
        gridOuter.setAttribute('role', 'grid')
        gridOuter.setAttribute('aria-rowcount', String(numRows))
        gridOuter.setAttribute('aria-colcount', String(numCols))

        gridOuter.style.setProperty('--vv-row-header-width', `${this.config.rowHeaderWidth}px`)
        gridOuter.style.setProperty('--vv-col-header-height', `${this.config.colHeaderHeight}px`)
        gridOuter.style.setProperty('--vv-row-height', `${this.config.rowHeight}px`)
        gridOuter.style.setProperty('--vv-row-height-inner', `${this.config.rowHeight - 2}px`)
        gridOuter.style.setProperty('--vv-col-header-height-inner', `${this.config.colHeaderHeight - 2}px`)

        const spacer = document.createElement('div')
        spacer.className = 'vv-spacer'
        spacer.style.width = `${totalWidth}px`
        spacer.style.height = `${totalHeight}px`

        const viewport = document.createElement('div')
        viewport.className = 'vv-viewport'
        viewport.setAttribute('role', 'rowgroup')

        gridWrap.appendChild(spacer)
        gridWrap.appendChild(viewport)

        colHeaderBar.innerHTML = ''
        colHeaderBar.setAttribute('role', 'rowgroup')

        rowHeaderCol.innerHTML = ''
        rowHeaderCol.setAttribute('role', 'rowgroup')

        return { gridOuter, gridWrap, viewport, colHeaderBar, rowHeaderCol, corner, spacer }
    }

    /**
     * Allocates the DOM node pool sized for the current viewport, including overscan.
     * Creates row divs, cell divs, column headers (with resize handles), and row headers.
     * @param scaffold - The grid scaffold to append pool nodes into.
     * @param viewHeight - Current viewport height in pixels, used to size the row pool.
     * @param viewWidth - Current viewport width in pixels, used to size the column pool.
     * @returns The allocated cell pool containing all pre-created DOM nodes.
     */
    allocate (scaffold: GridScaffold, viewHeight: number, viewWidth: number): CellPool {
        const visibleRows = Math.ceil(viewHeight / this.config.rowHeight) + 1
        const visibleCols = Math.ceil(viewWidth / this.config.minColWidth) + 1

        const poolRows = visibleRows + 2 * this.config.overscanRows
        const poolCols = visibleCols + 2 * this.config.overscanCols

        const rowDivs: HTMLDivElement[] = []
        const cells: HTMLDivElement[][] = []

        for (let r = 0; r < poolRows; r++) {
            const rowDiv = document.createElement('div')
            rowDiv.className = 'vv-pool-row'
            rowDiv.setAttribute('role', 'row')
            rowDiv.style.top = `${r * this.config.rowHeight}px`

            const rowCells: HTMLDivElement[] = []
            for (let c = 0; c < poolCols; c++) {
                const cell = document.createElement('div')
                cell.className = 'vv-pool-cell'
                cell.setAttribute('role', 'gridcell')
                rowDiv.appendChild(cell)
                rowCells.push(cell)
            }

            scaffold.viewport.appendChild(rowDiv)
            rowDivs.push(rowDiv)
            cells.push(rowCells)
        }

        const colHeaderContainer = document.createElement('div')
        colHeaderContainer.className = 'vv-col-header-container'
        colHeaderContainer.setAttribute('role', 'row')
        scaffold.colHeaderBar.appendChild(colHeaderContainer)

        const colHeaders: HTMLDivElement[] = []
        const colHeaderLabels: HTMLSpanElement[] = []
        for (let c = 0; c < poolCols; c++) {
            const header = document.createElement('div')
            header.className = 'vv-pool-col-header'
            header.setAttribute('role', 'columnheader')

            const label = document.createElement('span')
            header.appendChild(label)

            const handle = document.createElement('div')
            handle.className = 'vv-col-resize-handle'
            header.appendChild(handle)

            colHeaderContainer.appendChild(header)
            colHeaders.push(header)
            colHeaderLabels.push(label)
        }

        const rowHeaderContainer = document.createElement('div')
        rowHeaderContainer.setAttribute('role', 'row')
        scaffold.rowHeaderCol.appendChild(rowHeaderContainer)

        const rowHeaders: HTMLDivElement[] = []
        for (let r = 0; r < poolRows; r++) {
            const header = document.createElement('div')
            header.className = 'vv-pool-row-header'
            header.setAttribute('role', 'rowheader')
            rowHeaderContainer.appendChild(header)
            rowHeaders.push(header)
        }

        return { poolRows, poolCols, rowDivs, cells, colHeaders, colHeaderLabels, rowHeaders, colHeaderContainer, rowHeaderContainer }
    }

    /**
     * Reassigns all pool nodes to their current data coordinates by updating className, dataset,
     * ARIA attributes, styles, and text content in place. Nodes beyond the rendered range are
     * reset to their idle state.
     * @param pool - The pre-allocated DOM node pool.
     * @param range - The rendered range specifying which rows/cols to display.
     * @param columnLayout - Current column widths and offsets.
     * @param columns - Column label metadata, or null if none.
     * @param rows - Row label metadata, or null if none.
     * @param chunkCache - The data cache to read cell values from.
     * @param selectionModel - Current selection state for highlighting.
     * @param scrollTop - Current vertical scroll offset for header positioning.
     * @param scrollLeft - Current horizontal scroll offset for header positioning.
     * @param scaffold - The grid scaffold for positioning the viewport element.
     */
    render (
        pool: CellPool,
        range: RenderedRange,
        columnLayout: ColumnLayout,
        columns: VariableColumns | null,
        rows: VariableRows | null,
        chunkCache: ChunkCache,
        selectionModel: SelectionModel,
        scrollTop: number,
        scrollLeft: number,
        scaffold: GridScaffold
    ): void {
        const { startRow, startCol, renderedRows, renderedCols } = range

        const viewportLeft = columnLayout.getOffset(startCol)
        const viewportTop = startRow * this.config.rowHeight
        const viewportRight = startCol + renderedCols < columnLayout.getColumnCount()
            ? columnLayout.getOffset(startCol + renderedCols)
            : columnLayout.getTotalWidth()
        const viewportWidth = viewportRight - viewportLeft

        this.lastViewportLeft = viewportLeft
        this.lastViewportTop = viewportTop

        scaffold.viewport.style.top = `${viewportTop}px`
        scaffold.viewport.style.left = `${viewportLeft}px`
        scaffold.viewport.style.width = `${viewportWidth}px`
        scaffold.viewport.style.height = `${renderedRows * this.config.rowHeight}px`

        for (let ri = 0; ri < pool.poolRows; ri++) {
            const rowDiv = pool.rowDivs[ri]
            if (ri < renderedRows) {
                const dataRow = startRow + ri
                rowDiv.className = 'vv-pool-row vv-row'
                rowDiv.style.top = `${ri * this.config.rowHeight}px`
                rowDiv.dataset.row = String(dataRow + 1)
                rowDiv.setAttribute('aria-rowindex', String(dataRow + 1))

                for (let ci = 0; ci < pool.poolCols; ci++) {
                    const cell = pool.cells[ri][ci]
                    if (ci < renderedCols) {
                        const dataCol = startCol + ci
                        const colWidth = columnLayout.getWidth(dataCol)
                        const isSelected = selectionModel.isSelected(dataRow + 1, dataCol + 1)
                        cell.className = isSelected ? 'vv-pool-cell vv-cell vv-cell-selected' : 'vv-pool-cell vv-cell'
                        cell.id = `vv-cell-r${dataRow + 1}-c${dataCol + 1}`
                        cell.dataset.row = String(dataRow + 1)
                        cell.dataset.col = String(dataCol + 1)
                        cell.setAttribute('aria-colindex', String(dataCol + 1))
                        cell.setAttribute('aria-selected', isSelected ? 'true' : 'false')
                        cell.style.width = `${colWidth}px`
                        cell.style.minWidth = `${colWidth}px`

                        const raw = chunkCache.get(dataRow, dataCol)
                        if (raw == null) {
                            cell.className = isSelected ? 'vv-pool-cell vv-cell vv-cell-loading vv-cell-selected' : 'vv-pool-cell vv-cell vv-cell-loading'
                            if (cell.textContent !== '') {
                                cell.textContent = ''
                            }
                        } else if (cell.textContent !== raw) {
                            cell.textContent = raw
                        }
                    } else {
                        cell.className = 'vv-pool-cell'
                        cell.id = ''
                        cell.textContent = ''
                        cell.style.width = ''
                        cell.style.minWidth = ''
                        cell.removeAttribute('aria-colindex')
                        cell.setAttribute('aria-selected', 'false')
                        delete cell.dataset.row
                        delete cell.dataset.col
                    }
                }
            } else {
                rowDiv.className = 'vv-pool-row'
                rowDiv.removeAttribute('aria-rowindex')
                delete rowDiv.dataset.row
                for (let ci = 0; ci < pool.poolCols; ci++) {
                    const cell = pool.cells[ri][ci]
                    cell.className = 'vv-pool-cell'
                    cell.id = ''
                    cell.textContent = ''
                    cell.style.width = ''
                    cell.style.minWidth = ''
                    cell.removeAttribute('aria-colindex')
                    cell.setAttribute('aria-selected', 'false')
                    delete cell.dataset.row
                    delete cell.dataset.col
                }
            }
        }

        pool.colHeaderContainer.style.transform = `translateX(${viewportLeft - scrollLeft}px)`

        for (let ci = 0; ci < pool.poolCols; ci++) {
            const header = pool.colHeaders[ci]
            const label = pool.colHeaderLabels[ci]
            const handle = header.lastElementChild as HTMLElement
            if (ci < renderedCols) {
                const colIdx = startCol + ci
                const colWidth = columnLayout.getWidth(colIdx)
                header.className = 'vv-pool-col-header vv-col-header'
                header.setAttribute('aria-colindex', String(colIdx + 1))
                header.style.width = `${colWidth}px`
                header.style.minWidth = `${colWidth}px`
                if (handle != null) handle.className = 'vv-col-resize-handle'
                if (columns?.labels != null && colIdx < columns.labels.length) {
                    label.textContent = columns.labels[colIdx].name
                } else {
                    label.textContent = String(colIdx + 1)
                }
            } else {
                header.className = 'vv-pool-col-header'
                header.removeAttribute('aria-colindex')
                label.textContent = ''
                header.style.width = ''
                header.style.minWidth = ''
                if (handle != null) handle.className = ''
            }
        }

        pool.rowHeaderContainer.style.transform = `translateY(${startRow * this.config.rowHeight - scrollTop}px)`

        for (let ri = 0; ri < pool.poolRows; ri++) {
            const header = pool.rowHeaders[ri]
            if (ri < renderedRows) {
                const rowIdx = startRow + ri
                header.className = 'vv-pool-row-header vv-row-header'
                header.setAttribute('aria-rowindex', String(rowIdx + 1))
                if (rows?.labels != null && rowIdx < rows.labels.length) {
                    header.textContent = rows.labels[rowIdx].name
                } else {
                    header.textContent = String(rowIdx + 1)
                }
            } else {
                header.className = 'vv-pool-row-header'
                header.removeAttribute('aria-rowindex')
                header.textContent = ''
            }
        }
    }

    /**
     * Applies CSS transforms to pin column and row header containers in sync with scroll position.
     * @param pool - The cell pool containing the header containers.
     * @param scrollTop - Current vertical scroll offset for row header alignment.
     * @param scrollLeft - Current horizontal scroll offset for column header alignment.
     */
    pinHeaders (pool: CellPool, scrollTop: number, scrollLeft: number): void {
        pool.colHeaderContainer.style.transform = `translateX(${this.lastViewportLeft - scrollLeft}px)`
        pool.rowHeaderContainer.style.transform = `translateY(${this.lastViewportTop - scrollTop}px)`
    }

    /**
     * Updates the spacer element width after a column resize to maintain correct scroll range.
     * @param scaffold - The grid scaffold containing the spacer element.
     * @param columnLayout - The column layout with updated total width.
     */
    updateSpacerWidth (scaffold: GridScaffold, columnLayout: ColumnLayout): void {
        const totalWidth = columnLayout.getTotalWidth() + this.config.scrollPadding
        scaffold.spacer.style.width = `${totalWidth}px`
    }
}
