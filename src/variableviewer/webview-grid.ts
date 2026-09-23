// Copyright 2026 The MathWorks, Inc.

import { ContentRenderer, VariableMetadata, VariableColumns, VariableRows, ExtToVVWebview, VVWebviewToExt } from './types'
import { DEFAULT_CONFIG } from './grid/GridConfig'
import { ColumnLayout } from './grid/ColumnLayout'
import { ViewportModel } from './grid/ViewportModel'
import { ChunkCache } from './grid/ChunkCache'
import { ScrollEngine } from './grid/ScrollEngine'
import { SelectionModel } from './grid/SelectionModel'
import { NavigationModel } from './grid/NavigationModel'
import { ColumnResizeModel } from './grid/ColumnResizeModel'
import { GridDomPool, GridScaffold, CellPool } from './grid/GridDomPool'

interface VsCodeApi { postMessage: (msg: VVWebviewToExt) => void }

const config = DEFAULT_CONFIG

/**
 * Virtual-scrolling grid renderer for numeric and tabular MATLAB variables.
 * Pre-allocates a fixed DOM node pool and recycles nodes on scroll by updating
 * attributes in place. Fetches data in chunks on demand as the user scrolls.
 */
export class GridRenderer implements ContentRenderer {
    private container: HTMLElement | null = null
    private gridOuter: HTMLElement | null = null
    private gridWrap: HTMLElement | null = null
    private colHeaderBar: HTMLElement | null = null
    private rowHeaderCol: HTMLElement | null = null
    private corner: HTMLElement | null = null
    private statusText: HTMLElement | null = null
    private statusBar: HTMLElement | null = null

    private scaffold: GridScaffold | null = null
    private pool: CellPool | null = null

    private metadata: VariableMetadata | null = null
    private columns: VariableColumns | null = null
    private rows: VariableRows | null = null
    private cachedScrollTop: number = 0
    private cachedScrollLeft: number = 0
    private rafId: number | null = null
    private dirty: boolean = false
    private resizeObserver: ResizeObserver | null = null

    private readonly columnLayout = new ColumnLayout(config)
    private readonly viewportModel = new ViewportModel(config)
    private readonly chunkCache = new ChunkCache(config)
    private readonly scrollEngine = new ScrollEngine(config)
    private readonly selectionModel = new SelectionModel()
    private readonly navigationModel = new NavigationModel()
    private readonly resizeModel = new ColumnResizeModel()
    private readonly domPool = new GridDomPool(config)
    private lastScrollTop: number = 0
    private lastScrollLeft: number = 0
    private scrollTelemetryTimer: ReturnType<typeof setTimeout> | undefined

    /**
     * @param api - The VS Code webview API for posting messages to the extension host.
     * @param varName - The MATLAB variable name this renderer displays.
     */
    constructor (
        private readonly api: VsCodeApi,
        private varName: string
    ) {
        this.scrollEngine.onSettle(() => this.requestVisibleChunks())
    }

    /**
     * Creates the grid DOM structure (headers, viewport, status bar) inside the given container.
     * @param container - The parent element to populate with the grid layout.
     */
    mount (container: HTMLElement): void {
        this.container = container
        container.innerHTML = `
            <div class="vv-grid-outer">
                <div class="vv-corner"></div>
                <div class="vv-col-header-bar"></div>
                <div class="vv-row-header-col"></div>
                <div class="vv-grid-wrap"></div>
            </div>
            <div class="vv-status-bar">
                <span class="vv-status-text"></span>
            </div>
        `
        this.gridOuter = container.querySelector('.vv-grid-outer') as HTMLElement
        this.gridWrap = container.querySelector('.vv-grid-wrap') as HTMLElement
        this.colHeaderBar = container.querySelector('.vv-col-header-bar') as HTMLElement
        this.rowHeaderCol = container.querySelector('.vv-row-header-col') as HTMLElement
        this.corner = container.querySelector('.vv-corner') as HTMLElement
        this.statusBar = container.querySelector('.vv-status-bar') as HTMLElement
        this.statusText = container.querySelector('.vv-status-text') as HTMLElement

        this.gridWrap.addEventListener('scroll', this.handleGridScroll)
        this.gridOuter.addEventListener('focus', this.handleGridFocus)
        document.addEventListener('keydown', this.handleKeydown)

        this.reportViewportSize()

        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                if (this.pool == null || this.gridWrap == null || this.scaffold == null) return
                const neededRows = Math.ceil(this.gridWrap.clientHeight / config.rowHeight) + 1 + 2 * config.overscanRows
                const neededCols = Math.ceil(this.gridWrap.clientWidth / config.minColWidth) + 1 + 2 * config.overscanCols
                if (neededRows > this.pool.poolRows || neededCols > this.pool.poolCols) {
                    this.scaffold.viewport.innerHTML = ''
                    this.scaffold.colHeaderBar.innerHTML = ''
                    this.scaffold.rowHeaderCol.innerHTML = ''
                    this.pool = this.domPool.allocate(this.scaffold, this.gridWrap.clientHeight, this.gridWrap.clientWidth)
                    this.attachPoolListeners()
                }
                this.reportViewportSize()
                this.markDirty()
            })
            this.resizeObserver.observe(this.gridWrap)
        }
    }

    /**
     * Routes an incoming message from the extension host to the appropriate handler.
     * @param msg - The message to handle.
     */
    handleMessage (msg: ExtToVVWebview): void {
        switch (msg.type) {
            case 'variableResponse':
                this.onVariableResponse(msg)
                break
            case 'dataStale':
                this.onDataStale()
                break
            case 'error':
                this.onError(msg.message)
                break
        }
    }

    setVarName (newName: string): void {
        this.varName = newName
        if (this.gridOuter != null) {
            this.gridOuter.setAttribute('aria-label', `${newName} data grid`)
        }
        this.updateStatusBar()
    }

    /**
     * Receives MATLAB state updates. The grid renderer does not act on these.
     * @param _connected - Whether MATLAB is connected.
     * @param _idle - Whether MATLAB is idle.
     */
    onMatlabState (_connected: boolean, _idle: boolean): void {
        // Grid renderer has no MATLAB state behavior
    }

    /** Tears down all event listeners, timers, observers, and clears the DOM. */
    dispose (): void {
        if (this.gridWrap != null) {
            this.gridWrap.removeEventListener('scroll', this.handleGridScroll)
        }
        if (this.gridOuter != null) {
            this.gridOuter.removeEventListener('focus', this.handleGridFocus)
        }
        document.removeEventListener('keydown', this.handleKeydown)
        document.removeEventListener('mousemove', this.handleResizeMouseMove)
        document.removeEventListener('mouseup', this.handleResizeMouseUp)
        if (this.resizeObserver != null) {
            this.resizeObserver.disconnect()
            this.resizeObserver = null
        }
        if (this.rafId != null) {
            cancelAnimationFrame(this.rafId)
            this.rafId = null
        }
        if (this.scrollTelemetryTimer != null) {
            clearTimeout(this.scrollTelemetryTimer)
            this.scrollTelemetryTimer = undefined
        }
        this.scrollEngine.dispose()
        this.chunkCache.clear()
        if (this.container != null) {
            this.container.innerHTML = ''
        }
        this.container = null
        this.gridOuter = null
        this.gridWrap = null
        this.colHeaderBar = null
        this.rowHeaderCol = null
        this.corner = null
        this.scaffold = null
        this.pool = null
    }

    // ── Message Handlers ────────────────────────────────────────────

    /**
     * Handles a variable response containing metadata and optional cell data.
     * Rebuilds the grid scaffold if the variable's structure changed, then renders.
     * @param msg - The variable response message.
     */
    private onVariableResponse (msg: Extract<ExtToVVWebview, { type: 'variableResponse' }>): void {
        const prevMetadata = this.metadata
        this.metadata = msg.metadata
        this.columns = msg.columns ?? null
        this.rows = msg.rows ?? null

        const structureChanged = prevMetadata == null ||
            msg.metadata.dataType !== prevMetadata.dataType ||
            msg.metadata.size[0] !== prevMetadata.size[0] ||
            msg.metadata.size[1] !== prevMetadata.size[1]

        const gridMissing = this.scaffold == null ||
            this.gridWrap == null ||
            !this.gridWrap.contains(this.scaffold.spacer)

        if (msg.cells != null) {
            if (structureChanged || gridMissing) {
                const restoreTop = structureChanged ? 0 : this.cachedScrollTop
                const restoreLeft = structureChanged ? 0 : this.cachedScrollLeft
                this.clearLoadedData()
                this.setupVirtualGrid()
                if (this.gridWrap != null) {
                    this.gridWrap.scrollTop = restoreTop
                    this.gridWrap.scrollLeft = restoreLeft
                }
            }
            this.chunkCache.store(msg.cells)
            this.updateStatusBar()
            this.renderVisibleCells()
            this.requestVisibleChunks()
        } else {
            if (structureChanged || gridMissing) {
                this.clearLoadedData()
                this.setupVirtualGrid()
                this.renderVisibleCells()
            } else {
                this.renderVisibleCells()
                this.requestVisibleChunks()
            }
        }
    }

    /** Handles a stale-data notification by clearing the cache and re-fetching visible chunks. */
    private onDataStale (): void {
        this.chunkCache.clear()
        this.selectionModel.clear()
        this.updateStatusBar()
        this.renderVisibleCells()
        this.requestVisibleChunks()
    }

    /**
     * Displays an error message in the status bar.
     * @param message - The error message text to show.
     */
    private onError (message: string): void {
        if (this.statusText == null) return
        this.statusText.textContent = `Error: ${message}`
        this.statusText.classList.add('vv-error')
    }

    // ── Virtual Grid Setup ──────────────────────────────────────────

    /** Builds the grid scaffold, allocates the DOM pool, and sets up ARIA attributes. */
    private setupVirtualGrid (): void {
        if (this.gridWrap == null || this.gridOuter == null || this.colHeaderBar == null || this.rowHeaderCol == null || this.corner == null || this.metadata == null) return

        const [numRows, numCols] = this.getGridDimensions()
        this.columnLayout.computeWidths(numCols, this.columns?.labels)
        this.viewportModel.setDimensions(numRows, numCols)

        this.scaffold = this.domPool.createScaffold(this.gridOuter, this.gridWrap, this.colHeaderBar, this.rowHeaderCol, this.corner, numRows, numCols, this.columnLayout, this.metadata.dataType)
        this.gridOuter.setAttribute('aria-label', `${this.varName} data grid`)
        this.gridOuter.setAttribute('tabindex', '0')
        this.scaffold.viewport.addEventListener('mousedown', this.handleGridClick)

        this.cachedScrollTop = 0
        this.cachedScrollLeft = 0

        this.pool = this.domPool.allocate(this.scaffold, this.gridWrap.clientHeight, this.gridWrap.clientWidth)
        this.attachPoolListeners()
    }

    /** Attaches column resize event listeners to the current pool's header container. */
    private attachPoolListeners (): void {
        if (this.pool == null) return
        this.pool.colHeaderContainer.addEventListener('mousedown', this.handleResizeMouseDown)
        this.pool.colHeaderContainer.addEventListener('dblclick', this.handleResizeDblClick)
    }

    // ── rAF Gating ─────────────────────────────────────────────────

    /** Schedules a render on the next animation frame if one is not already pending. */
    private markDirty (): void {
        if (!this.dirty) {
            this.dirty = true
            this.rafId = requestAnimationFrame(() => this.renderFrame())
        }
    }

    /** Animation frame callback that clears the dirty flag and renders. */
    private renderFrame (): void {
        this.dirty = false
        this.rafId = null
        this.renderVisibleCells()
    }

    // ── Rendering ──────────────────────────────────────────────────

    /** Computes the visible range from the current scroll position and renders pool nodes. */
    private renderVisibleCells (): void {
        if (this.metadata == null || this.pool == null || this.gridWrap == null || this.scaffold == null) return

        const scrollTop = this.gridWrap.scrollTop
        const scrollLeft = this.gridWrap.scrollLeft
        const viewHeight = this.gridWrap.clientHeight
        const viewWidth = this.gridWrap.clientWidth

        this.cachedScrollTop = scrollTop
        this.cachedScrollLeft = scrollLeft

        this.viewportModel.update(scrollTop, scrollLeft, viewHeight, viewWidth, this.columnLayout, this.pool.poolRows, this.pool.poolCols)
        const range = this.viewportModel.getRenderedRange()

        this.domPool.render(
            this.pool, range, this.columnLayout,
            this.columns, this.rows,
            this.chunkCache, this.selectionModel,
            scrollTop, scrollLeft, this.scaffold
        )
    }

    // ── On-Demand Data Loading ──────────────────────────────────────

    /** Scroll event handler that pins headers, feeds the scroll engine, and schedules a render. */
    private readonly handleGridScroll = (): void => {
        if (this.gridWrap == null) return

        const newTop = this.gridWrap.scrollTop
        const newLeft = this.gridWrap.scrollLeft

        if (this.pool != null) {
            this.domPool.pinHeaders(this.pool, newTop, newLeft)
        }
        this.scrollEngine.handleScroll(newTop, newLeft)
        this.markDirty()

        const verticalDelta = Math.abs(newTop - this.lastScrollTop)
        const horizontalDelta = Math.abs(newLeft - this.lastScrollLeft)
        if (verticalDelta > 0 || horizontalDelta > 0) {
            const scrollType: 'horizontal' | 'vertical' = horizontalDelta > verticalDelta ? 'horizontal' : 'vertical'
            this.postScrollTelemetry(scrollType)
        }
        this.lastScrollTop = newTop
        this.lastScrollLeft = newLeft
    }

    /**
     * Posts a debounced scroll telemetry message to the extension host.
     * Uses a 1-second timer so rapid scrolling produces at most one event per second.
     * @param scrollType - The dominant scroll direction.
     */
    private postScrollTelemetry (scrollType: 'horizontal' | 'vertical'): void {
        if (this.scrollTelemetryTimer != null) {
            clearTimeout(this.scrollTelemetryTimer)
        }
        this.scrollTelemetryTimer = setTimeout(() => {
            this.scrollTelemetryTimer = undefined
            this.api.postMessage({ type: 'scrolled', scrollType })
        }, 1000)
    }

    /** Reports the current viewport dimensions to the extension host for telemetry. */
    private reportViewportSize (): void {
        if (this.gridWrap == null) return
        this.api.postMessage({
            type: 'reportViewportSize',
            width: this.gridWrap.clientWidth,
            height: this.gridWrap.clientHeight
        })
    }

    /** Determines which data chunks are needed for the current viewport and requests them. */
    private requestVisibleChunks (): void {
        if (this.metadata == null || this.gridWrap == null) return

        this.chunkCache.clearStale(config.chunkTimeoutMs)

        const scrollTop = this.gridWrap.scrollTop
        const scrollLeft = this.gridWrap.scrollLeft
        const viewHeight = this.gridWrap.clientHeight
        const viewWidth = this.gridWrap.clientWidth

        const visibleRange = this.viewportModel.computeVisibleRangeFromScroll(scrollTop, scrollLeft, viewHeight, viewWidth, this.columnLayout)
        const needed = this.chunkCache.getNeededChunks(visibleRange, this.viewportModel.getDimensions())

        for (const req of needed) {
            this.chunkCache.markPending(req.key)
            this.api.postMessage({
                type: 'requestPage',
                varName: this.varName,
                startRow: req.startRow,
                startCol: req.startCol
            })
        }
    }

    // ── Grid Interaction ────────────────────────────────────────────

    /** Focus handler that selects cell (1,1) when no cell is selected, enabling keyboard-only entry. */
    private readonly handleGridFocus = (): void => {
        if (this.selectionModel.getSelected() != null) return
        if (this.metadata == null) return
        const [numRows, numCols] = this.getGridDimensions()
        if (numRows > 0 && numCols > 0) {
            this.selectCell(1, 1)
        }
    }

    /** Click handler that selects the cell under the cursor. */
    private readonly handleGridClick = (e: Event): void => {
        const target = e.target as HTMLElement
        const cell = target.closest('.vv-cell') as HTMLElement
        if (cell == null) return

        const row = Number(cell.dataset.row)
        const col = Number(cell.dataset.col)
        this.selectCell(row, col)
    }

    /** Keydown handler that moves selection via arrow keys and scrolls the cell into view. */
    private readonly handleKeydown = (e: KeyboardEvent): void => {
        const currentCell = this.selectionModel.getSelected()
        if (currentCell == null) return
        if (this.metadata == null) return

        const newCell = this.navigationModel.computeMove(e.key, currentCell, this.getGridDimensions())
        if (newCell == null) return

        e.preventDefault()
        this.selectCell(newCell.row, newCell.col)
        this.scrollCellIntoView(newCell.row, newCell.col)
    }

    /**
     * Selects a cell, updates ARIA active-descendant, re-renders, and updates the status bar.
     * @param row - 1-based row index of the cell to select.
     * @param col - 1-based column index of the cell to select.
     */
    private selectCell (row: number, col: number): void {
        this.selectionModel.select(row, col)
        if (this.gridOuter != null) {
            this.gridOuter.setAttribute('aria-activedescendant', `vv-cell-r${row}-c${col}`)
        }
        this.renderVisibleCells()
        this.updateStatusBar()
    }

    /**
     * Scrolls the grid viewport so that the specified cell is fully visible.
     * @param row - 1-based row index.
     * @param col - 1-based column index.
     */
    private scrollCellIntoView (row: number, col: number): void {
        if (this.gridWrap == null) return

        const colOffset = this.columnLayout.getOffset(col - 1)
        const colWidth = this.columnLayout.getWidth(col - 1)

        const cellTop = (row - 1) * config.rowHeight
        const cellLeft = colOffset

        if (cellTop < this.gridWrap.scrollTop) {
            this.gridWrap.scrollTop = cellTop
        } else if (cellTop + config.rowHeight > this.gridWrap.scrollTop + this.gridWrap.clientHeight) {
            this.gridWrap.scrollTop = cellTop + config.rowHeight - this.gridWrap.clientHeight
        }

        if (cellLeft < this.gridWrap.scrollLeft) {
            this.gridWrap.scrollLeft = cellLeft
        } else if (cellLeft + colWidth > this.gridWrap.scrollLeft + this.gridWrap.clientWidth) {
            this.gridWrap.scrollLeft = cellLeft + colWidth - this.gridWrap.clientWidth
        }
    }

    /** Updates the status bar to show the selected cell's coordinate and value. */
    private updateStatusBar (): void {
        if (this.statusText == null) return
        this.statusText.classList.remove('vv-error')

        const selected = this.selectionModel.getSelected()
        if (selected == null || this.metadata == null) {
            this.statusText.textContent = ''
            return
        }

        const { row, col } = selected
        const value = this.chunkCache.get(row - 1, col - 1) ?? ''
        this.statusText.textContent = `${this.varName}(${row},${col}) = ${value}`
    }

    // ── Column Resize ───────────────────────────────────────────────

    /** Mousedown handler on column header resize handles that initiates a drag. */
    private readonly handleResizeMouseDown = (e: MouseEvent): void => {
        const handle = (e.target as HTMLElement).closest('.vv-col-resize-handle')
        if (handle == null || this.pool == null) return
        const headerDiv = handle.parentElement
        if (headerDiv == null) return

        const poolIndex = this.pool.colHeaders.indexOf(headerDiv as HTMLDivElement)
        if (poolIndex < 0) return

        const { startCol } = this.viewportModel.getRenderedRange()
        const dataCol = startCol + poolIndex
        const currentWidth = this.columnLayout.getWidth(dataCol)

        this.resizeModel.beginDrag(dataCol, e.clientX, currentWidth)
        this.gridOuter?.classList.add('vv-col-resize-active')

        document.addEventListener('mousemove', this.handleResizeMouseMove)
        document.addEventListener('mouseup', this.handleResizeMouseUp)
        e.preventDefault()
        e.stopPropagation()
    }

    /** Mousemove handler during column resize that updates width and re-renders. */
    private readonly handleResizeMouseMove = (e: MouseEvent): void => {
        if (!this.resizeModel.isDragging()) return

        const drag = this.resizeModel.getDrag()
        if (drag == null) return

        const newWidth = this.resizeModel.computeNewWidth(e.clientX, this.columnLayout.getMinWidth())
        this.columnLayout.setWidth(drag.colIndex, newWidth)
        if (this.scaffold != null) {
            this.domPool.updateSpacerWidth(this.scaffold, this.columnLayout)
        }
        this.scrollToExposeResizeEdge(drag.colIndex)
        this.markDirty()
    }

    /**
     * Scrolls the grid horizontally if the right edge of the column being resized
     * exceeds the visible area, keeping the resize handle visible during drag.
     * @param colIndex - 0-based index of the column being resized.
     */
    private scrollToExposeResizeEdge (colIndex: number): void {
        if (this.gridWrap == null) return
        const colRightEdge = this.columnLayout.getOffset(colIndex) + this.columnLayout.getWidth(colIndex)
        const visibleContentRight = this.gridWrap.scrollLeft + this.gridWrap.clientWidth
        if (colRightEdge > visibleContentRight) {
            this.gridWrap.scrollLeft = colRightEdge - this.gridWrap.clientWidth + config.scrollPadding
        }
    }

    /** Mouseup handler that ends the column resize drag and removes document listeners. */
    private readonly handleResizeMouseUp = (): void => {
        this.resizeModel.endDrag()
        this.gridOuter?.classList.remove('vv-col-resize-active')
        document.removeEventListener('mousemove', this.handleResizeMouseMove)
        document.removeEventListener('mouseup', this.handleResizeMouseUp)
    }

    /** Double-click handler on resize handles that auto-fits the column to its content width. */
    private readonly handleResizeDblClick = (e: MouseEvent): void => {
        const handle = (e.target as HTMLElement).closest('.vv-col-resize-handle')
        if (handle == null || this.pool == null) return
        const headerDiv = handle.parentElement
        if (headerDiv == null) return

        const poolIndex = this.pool.colHeaders.indexOf(headerDiv as HTMLDivElement)
        if (poolIndex < 0) return

        const { startCol } = this.viewportModel.getRenderedRange()
        const dataCol = startCol + poolIndex
        const fitWidth = this.measureColumnContentWidth(dataCol, poolIndex)

        this.columnLayout.setWidth(dataCol, fitWidth)
        if (this.scaffold != null) {
            this.domPool.updateSpacerWidth(this.scaffold, this.columnLayout)
        }
        this.markDirty()
    }

    /**
     * Measures the maximum content width across all rendered cells in a column,
     * used for auto-fit on double-click.
     * @param dataCol - 0-based data column index (for bounds reference).
     * @param poolCol - Index into the pool's column array for the rendered cells.
     * @returns The computed fit width in pixels, floored at minimum column width.
     */
    private measureColumnContentWidth (dataCol: number, poolCol: number): number {
        if (this.pool == null) return config.minColWidth

        const { renderedRows } = this.viewportModel.getRenderedRange()
        let maxWidth = config.minColWidth

        for (let ri = 0; ri < renderedRows; ri++) {
            const cell = this.pool.cells[ri][poolCol]
            const text = cell.textContent ?? ''
            const textWidth = text.length * config.charWidth + config.headerPadding
            if (textWidth > maxWidth) maxWidth = textWidth
        }

        const headerText = this.pool.colHeaderLabels[poolCol]?.textContent ?? ''
        const headerWidth = headerText.length * config.charWidth + config.headerPadding
        if (headerWidth > maxWidth) maxWidth = headerWidth

        return maxWidth
    }

    // ── Utilities ───────────────────────────────────────────────────

    /**
     * Extracts the grid dimensions from the current variable metadata.
     * @returns A [rows, cols] tuple, defaulting to [0, 0] if metadata is unavailable.
     */
    private getGridDimensions (): [number, number] {
        if (this.metadata == null) return [0, 0]
        const numRows = this.metadata.size[0] ?? 0
        const numCols = this.metadata.size[1] ?? 1
        return [numRows, numCols]
    }

    /** Clears the chunk cache, selection, and ARIA active-descendant state. */
    private clearLoadedData (): void {
        this.chunkCache.clear()
        this.selectionModel.clear()
        if (this.gridOuter != null) {
            this.gridOuter.removeAttribute('aria-activedescendant')
        }
        this.updateStatusBar()
    }
}
