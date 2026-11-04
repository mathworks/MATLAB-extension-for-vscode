// Copyright 2026 The MathWorks, Inc.

// All webview UI logic in one module with exported functions for testability.
// No classes or custom elements — plain functions that operate on the DOM.

import { WorkspaceVariable, WorkspaceColumn, SavedState, ExtToWebview, WebviewToExt } from './types'
import { getIconFilename } from './icons'

// VsCodeApi is injected via init() — tests pass a mock, production uses acquireVsCodeApi()
interface VsCodeApi { postMessage: (msg: WebviewToExt) => void }

// Reads the icons base URI from the data attribute set by the provider on the body element
function getIconsBaseUri (): string {
    return document.body.dataset.iconsBaseUri ?? ''
}

// #region Module-Level State

let vscodeApi: VsCodeApi
let columns: WorkspaceColumn[] = []
let rows: WorkspaceVariable[] = []
let sortColumn: string = ''
let sortDirection: 'asc' | 'desc' = 'asc'
let columnWidths: Record<string, number> = {}
let selectedVarName: string | null = null
let focusedColName: string | null = null
let resizing: boolean = false
let mousedownInProgress: boolean = false
let pendingFocusRestore: boolean = false
let pendingDelete: boolean = false

// Minimum delay (ms) between first and second click to enter edit mode.
// Prevents double-clicks from accidentally triggering inline editing.
const EDIT_CLICK_DELAY_MS: number = 300

// #endregion

// #region Keyboard Bindings

type KeyAction = () => void
type KeyGuard = () => boolean

interface KeyBinding {
    key: string
    ctrlKey?: boolean
    action: KeyAction
    guard?: KeyGuard
}

function noInputEditing (): boolean {
    const active = document.activeElement as HTMLInputElement | null
    return !(active != null && active.tagName === 'INPUT' && !active.readOnly)
}

function firstColName (): string {
    return columns[0]?.name ?? 'Name'
}

function defaultColName (): string {
    return focusedColName ?? firstColName()
}

function announce (message: string): void {
    const el = document.getElementById('wsb-announcer')
    if (el == null) return
    el.textContent = ''
    requestAnimationFrame(() => { el.textContent = message })
}

function deleteSelectedVariable (): void {
    if (selectedVarName == null) return
    pendingDelete = true
    vscodeApi.postMessage({ type: 'deleteVariable', variable: selectedVarName })
}

function getFocusedCellInfo (): { tr: HTMLTableRowElement, colName: string } | null {
    const active = document.activeElement as HTMLElement | null
    if (active == null) return null
    const td = active.closest('td[data-col]')
    const tr = active.closest<HTMLTableRowElement>('tr[data-var]')
    if (td == null || tr == null) return null
    return { tr, colName: td.getAttribute('data-col')! }
}

function focusCell (tr: Element, colName: string): void {
    const td = tr.querySelector<HTMLElement>(`td[data-col="${CSS.escape(colName)}"]`)
    if (td != null) {
        selectRow(tr.getAttribute('data-var')!)
        focusedColName = colName
        td.focus()
        const tableWrap = tr.closest('.wsb-table-wrap')
        if (tableWrap != null) {
            const thead = tableWrap.querySelector('thead') as HTMLElement | null
            const headerHeight = thead?.offsetHeight ?? 0
            const wrapRect = tableWrap.getBoundingClientRect()
            const rowRect = (tr as HTMLElement).getBoundingClientRect()
            if (rowRect.top < wrapRect.top + headerHeight) {
                tableWrap.scrollTop += rowRect.top - wrapRect.top - headerHeight
            } else if (rowRect.bottom > wrapRect.bottom) {
                tableWrap.scrollTop += rowRect.bottom - wrapRect.bottom
            }
        }
    }
}

function moveDown (): void {
    const info = getFocusedCellInfo()
    if (info != null) {
        const next = info.tr.nextElementSibling
        if (next != null) focusCell(next, info.colName)
    } else {
        const first = document.querySelector('.wsb-table tbody tr')
        if (first != null) focusCell(first, firstColName())
    }
}

function moveUp (): void {
    const info = getFocusedCellInfo()
    if (info != null) {
        const prev = info.tr.previousElementSibling
        if (prev != null) focusCell(prev, info.colName)
    } else {
        const first = document.querySelector('.wsb-table tbody tr')
        if (first != null) focusCell(first, firstColName())
    }
}

function moveRight (): void {
    const info = getFocusedCellInfo()
    if (info == null) return
    const td = info.tr.querySelector(`td[data-col="${CSS.escape(info.colName)}"]`)
    const nextTd = td?.nextElementSibling as HTMLTableCellElement | null
    const nextCol = nextTd?.getAttribute('data-col')
    if (nextCol != null) focusCell(info.tr, nextCol)
}

function moveLeft (): void {
    const info = getFocusedCellInfo()
    if (info == null) return
    const td = info.tr.querySelector(`td[data-col="${CSS.escape(info.colName)}"]`)
    const prevTd = td?.previousElementSibling as HTMLTableCellElement | null
    const prevCol = prevTd?.getAttribute('data-col')
    if (prevCol != null) focusCell(info.tr, prevCol)
}

function editFocusedCell (): void {
    const active = document.activeElement as HTMLElement | null
    if (active == null) return
    const td = active.closest('td[data-col]') ?? (active.matches('td[data-col]') ? active : null)
    const input = td?.querySelector<HTMLInputElement>('.wsb-name-input, .wsb-value-input')
    if (input?.readOnly === true) enterEditMode(input)
}

function renameSelectedVariable (): void {
    if (selectedVarName == null) return
    const input = findNameInput(selectedVarName)
    if (input != null) enterEditMode(input)
}

function openSelectedVariable (): void {
    if (selectedVarName == null) return
    vscodeApi.postMessage({ type: 'openVariable', variable: selectedVarName })
}

function copySelectedVariableName (): void {
    if (selectedVarName == null) return
    void navigator.clipboard.writeText(selectedVarName)
    announce('Copied to clipboard')
}

function moveToFirstCellInRow (): void {
    const info = getFocusedCellInfo()
    if (info == null) return
    focusCell(info.tr, firstColName())
}

function moveToLastCellInRow (): void {
    const info = getFocusedCellInfo()
    if (info == null) return
    focusCell(info.tr, columns[columns.length - 1]?.name ?? 'Name')
}

function moveToFirstCell (): void {
    const first = document.querySelector('.wsb-table tbody tr')
    if (first != null) focusCell(first, firstColName())
}

function moveToLastCell (): void {
    const last = document.querySelector('.wsb-table tbody tr:last-child')
    if (last != null) focusCell(last, columns[columns.length - 1]?.name ?? 'Name')
}

function pageDown (): void {
    const info = getFocusedCellInfo()
    if (info == null) return
    const tableWrap = document.querySelector('.wsb-table-wrap') as HTMLElement
    if (tableWrap == null) return
    const rowHeight = info.tr.offsetHeight !== 0 ? info.tr.offsetHeight : 24
    const pageSize = Math.max(1, Math.floor(tableWrap.clientHeight / rowHeight) - 1)
    let target: Element = info.tr
    for (let i = 0; i < pageSize; i++) {
        const next = target.nextElementSibling
        if (next == null) break
        target = next
    }
    focusCell(target, info.colName)
}

function pageUp (): void {
    const info = getFocusedCellInfo()
    if (info == null) return
    const tableWrap = document.querySelector('.wsb-table-wrap') as HTMLElement
    if (tableWrap == null) return
    const rowHeight = info.tr.offsetHeight !== 0 ? info.tr.offsetHeight : 24
    const pageSize = Math.max(1, Math.floor(tableWrap.clientHeight / rowHeight) - 1)
    let target: Element = info.tr
    for (let i = 0; i < pageSize; i++) {
        const prev = target.previousElementSibling
        if (prev == null) break
        target = prev
    }
    focusCell(target, info.colName)
}

const KEY_BINDINGS: KeyBinding[] = [
    { key: 'c', ctrlKey: true, action: copySelectedVariableName, guard: noInputEditing },
    { key: 'd', ctrlKey: true, action: openSelectedVariable, guard: noInputEditing },
    { key: 'Home', ctrlKey: true, action: moveToFirstCell, guard: noInputEditing },
    { key: 'End', ctrlKey: true, action: moveToLastCell, guard: noInputEditing },
    { key: 'Delete', action: deleteSelectedVariable, guard: noInputEditing },
    { key: 'ArrowDown', ctrlKey: true, action: moveDown, guard: noInputEditing },
    { key: 'ArrowUp', ctrlKey: true, action: moveUp, guard: noInputEditing },
    { key: 'ArrowLeft', ctrlKey: true, action: moveLeft, guard: noInputEditing },
    { key: 'ArrowRight', ctrlKey: true, action: moveRight, guard: noInputEditing },
    { key: 'ArrowDown', action: moveDown, guard: noInputEditing },
    { key: 'ArrowUp', action: moveUp, guard: noInputEditing },
    { key: 'ArrowLeft', action: moveLeft, guard: noInputEditing },
    { key: 'ArrowRight', action: moveRight, guard: noInputEditing },
    { key: 'Home', action: moveToFirstCellInRow, guard: noInputEditing },
    { key: 'End', action: moveToLastCellInRow, guard: noInputEditing },
    { key: 'PageDown', action: pageDown, guard: noInputEditing },
    { key: 'PageUp', action: pageUp, guard: noInputEditing },
    { key: 'Enter', action: editFocusedCell, guard: noInputEditing },
    { key: ' ', action: editFocusedCell, guard: noInputEditing },
    { key: 'F2', action: renameSelectedVariable, guard: noInputEditing }
]

// #endregion

// #region Exported Functions

// Called once by webview-main.ts to bind event listeners and signal readiness
export function init (api: VsCodeApi): void {
    vscodeApi = api

    // Bind event delegation on the pre-existing table element created by the provider HTML
    const table = document.querySelector('.wsb-table') as HTMLTableElement
    if (table != null) {
        table.addEventListener('click', handleTableClick)
        table.addEventListener('dblclick', handleTableDblClick)
        table.addEventListener('mousedown', handleTableMouseDown)
        table.addEventListener('focusin', handleFocusIn)
        table.addEventListener('focusout', handleFocusOut)

        // WAI-ARIA grid pattern: tbody is the single Tab stop for the data area.
        // Individual cell inputs use tabIndex=-1 so Tab skips them; arrow keys
        // handle all intra-grid navigation. When tbody receives focus (via Tab),
        // we delegate to the last-focused cell, the selected row, or the first cell.
        const tbody = table.querySelector('tbody')
        if (tbody != null) {
            tbody.setAttribute('tabindex', '0')
            tbody.addEventListener('focus', () => {
                if (mousedownInProgress) return
                const info = getFocusedCellInfo()
                if (info != null) {
                    focusCell(info.tr, info.colName)
                } else if (selectedVarName != null) {
                    const row = tbody.querySelector(`tr[data-var="${CSS.escape(selectedVarName)}"]`)
                    if (row != null) focusCell(row, defaultColName())
                } else {
                    const first = tbody.querySelector('tr')
                    if (first != null) focusCell(first, defaultColName())
                }
            })
        }
    }

    document.addEventListener('mousedown', () => { mousedownInProgress = true }, true)
    document.addEventListener('mouseup', () => { mousedownInProgress = false }, true)

    // Handle keyboard shortcuts via the dispatch table
    document.addEventListener('keydown', handleDocumentKeydown)

    // When VS Code activates this webview (e.g. Ctrl+0), focus lands on <body>.
    // Redirect to the grid so the user starts on the data, not a secondary element.
    window.addEventListener('focus', () => {
        if (document.activeElement === document.body || document.activeElement === document.documentElement) {
            const tbody = document.querySelector<HTMLElement>('.wsb-table tbody')
            tbody?.focus()
        }
    })

    // Listen for messages from the extension host
    window.addEventListener('message', (e: MessageEvent) => {
        handleMessage(e.data as ExtToWebview)
    })

    // Signal readiness so the provider sends cached data
    vscodeApi.postMessage({ type: 'ready' })
}

// Dispatches inbound messages from the extension host
export function handleMessage (msg: ExtToWebview): void {
    switch (msg.type) {
        case 'setData': onSetData(msg.rows); break
        case 'setColumns': onSetColumns(msg.columns); break
        case 'setState': onSetState(msg.state); break
        case 'setTruncationInfo': onSetTruncationInfo(msg.displayedCount, msg.totalCount); break
        case 'themeChanged': onThemeChanged(); break
        case 'operationError': onOperationError(msg); break
        case 'sortFromContextMenu': onSortFromContextMenu(msg.column, msg.direction); break
        case 'focusValueInput': onFocusValueInput(msg.variable); break
        case 'focusNameInput': onFocusNameInput(msg.variable); break
    }
}

// Full table rebuild from current module-level state
export function renderTable (): void {
    const table = document.querySelector('.wsb-table') as HTMLTableElement
    if (table == null) return

    const thead = table.querySelector('thead') as HTMLTableSectionElement
    const tbody = table.querySelector('tbody') as HTMLTableSectionElement

    // Capture scroll position before clearing so it can be restored after rebuild
    const tableWrap = table.closest('.wsb-table-wrap')
    const scrollTop = tableWrap?.scrollTop ?? 0

    thead.innerHTML = ''
    tbody.innerHTML = ''

    if (columns.length === 0) return

    table.setAttribute('aria-rowcount', String(rows.length))
    table.setAttribute('aria-colcount', String(columns.length))

    // ── Build Header Row ─────────────────────────────────────────
    const headerRow = document.createElement('tr')
    headerRow.setAttribute('role', 'row')
    for (let i = 0; i < columns.length; i++) {
        const th = createHeaderCell(columns[i])
        th.setAttribute('aria-colindex', String(i + 1))
        headerRow.appendChild(th)
    }
    thead.appendChild(headerRow)

    // ── Build Data Rows ──────────────────────────────────────────
    for (const row of rows) {
        const tr = createDataRow(row)
        tbody.appendChild(tr)
    }

    if (rows.length === 0) {
        announce('No variables in workspace')
    }

    // Restore scroll position after rebuild (clamped to the new scroll range)
    if (tableWrap != null) {
        tableWrap.scrollTop = Math.min(scrollTop, tableWrap.scrollHeight - tableWrap.clientHeight)
    }
}

// Clears all module-level state — called in test teardown to prevent leakage
export function resetState (): void {
    columns = []
    rows = []
    sortColumn = ''
    sortDirection = 'asc'
    columnWidths = {}
    selectedVarName = null
    focusedColName = null
    resizing = false
}

// Returns a snapshot of current state for test assertions
export function getState (): {
    columns: WorkspaceColumn[]
    rows: WorkspaceVariable[]
    sortColumn: string
    sortDirection: 'asc' | 'desc'
    columnWidths: Record<string, number>
    selectedVarName: string | null
    focusedColName: string | null
} {
    return { columns, rows, sortColumn, sortDirection, columnWidths, selectedVarName, focusedColName }
}

// #endregion

// #region Message Handlers

function onSetData (newRows: WorkspaceVariable[]): void {
    const oldRows = rows
    rows = newRows

    const selectedMissing = selectedVarName != null && !newRows.some(r => r.name === selectedVarName)
    const deletedSelected = pendingDelete && selectedMissing
    let deletedIndex: number = -1
    if (selectedMissing) {
        deletedIndex = oldRows.findIndex(r => r.name === selectedVarName)
        if (deletedSelected) {
            pendingDelete = false
            announce(`Variable ${selectedVarName ?? ''} deleted`)
        }
        selectedVarName = null
    }

    const activeHeader = (document.activeElement as HTMLElement | null)?.closest('th[data-col]') as HTMLElement | null
    const activeHeaderCol = activeHeader?.getAttribute('data-col') ?? null

    if (canPatchInPlace(oldRows, newRows)) {
        patchRows(newRows)
    } else {
        renderTable()
    }

    if (activeHeaderCol != null) {
        const newTh = document.querySelector<HTMLElement>(`.wsb-table thead th[data-col="${CSS.escape(activeHeaderCol)}"]`)
        if (newTh != null) newTh.focus()
    } else if (deletedSelected && newRows.length > 0) {
        const tbody = document.querySelector('.wsb-table tbody')
        if (tbody != null) {
            const targetIndex = Math.min(deletedIndex, newRows.length - 1)
            const targetRow = tbody.children[targetIndex]
            if (targetRow != null) focusCell(targetRow, defaultColName())
        }
    } else if (pendingFocusRestore && selectedVarName != null) {
        pendingFocusRestore = false
        const tbody = document.querySelector('.wsb-table tbody')
        const targetRow = tbody?.querySelector(`tr[data-var="${CSS.escape(selectedVarName)}"]`)
        if (targetRow != null) focusCell(targetRow, defaultColName())
    }
}

function onSetColumns (newColumns: WorkspaceColumn[]): void {
    columns = newColumns
    renderTable()
}

// Merges incoming persisted state into module state and re-renders
function onSetState (state: SavedState): void {
    if (state.columnWidths != null) columnWidths = state.columnWidths
    if (state.sortColumn != null) sortColumn = state.sortColumn
    if (state.sortDirection != null) sortDirection = state.sortDirection
    renderTable()
}

// Shows or hides the truncation status bar below the table
function onSetTruncationInfo (displayedCount: number, totalCount: number): void {
    const statusBar = document.querySelector('.wsb-status-bar') as HTMLElement
    if (statusBar == null) return

    if (displayedCount < totalCount) {
        statusBar.innerHTML = ''
        const text = document.createElement('span')
        text.textContent = `Showing ${displayedCount} of ${totalCount} variables. `
        const link = document.createElement('a')
        link.textContent = 'Change limit'
        link.href = '#'
        link.className = 'wsb-status-link'
        link.addEventListener('click', (e: MouseEvent) => {
            e.preventDefault()
            vscodeApi.postMessage({ type: 'openMaxVariablesSetting' })
        })
        statusBar.appendChild(text)
        statusBar.appendChild(link)
        statusBar.style.display = 'block'
    } else {
        statusBar.style.display = 'none'
    }
}

// Handles errors from failed extension-side operations
function onOperationError (msg: { operation: string, variable: string, message: string }): void {
    if (msg.operation === 'editValue') {
        revertWithErrorFlash(findValueInput(msg.variable))
    } else if (msg.operation === 'rename') {
        revertRenameWithErrorFlash(msg.variable)
    }
    announce(`${msg.operation} failed: ${msg.message}`)
}

// Reverts a failed rename: finds the input by its stashed original name,
// undoes the optimistic data-var update, and shows the error flash.
function revertRenameWithErrorFlash (originalName: string): void {
    const input = findNameInput(originalName) ??
        document.querySelector<HTMLInputElement>(`.wsb-name-input[data-original-value="${CSS.escape(originalName)}"]`)
    if (input == null) return
    const tr = input.closest('tr')
    if (tr != null) {
        tr.dataset.var = originalName
        const context = JSON.parse(tr.getAttribute('data-vscode-context') ?? '{}')
        context.varName = originalName
        tr.setAttribute('data-vscode-context', JSON.stringify(context))
    }
    input.setAttribute('aria-label', `Name of variable ${originalName}`)
    revertWithErrorFlash(input)
}

// Reverts an input to its stashed original value and shows a transient red border
function revertWithErrorFlash (input: HTMLInputElement | null): void {
    if (input == null) return
    input.value = input.dataset.originalValue ?? ''
    input.classList.add('wsb-value-error')
    setTimeout(() => input.classList.remove('wsb-value-error'), 2000)
}

// Updates icon paths when the VS Code color theme changes
function onThemeChanged (): void {
    const isDark = document.body.classList.contains('vscode-dark')
    const icons = document.querySelectorAll<HTMLImageElement>('.wsb-icon')
    icons.forEach((img) => {
        const iconFile = getIconFilename(img.alt)
        img.src = `${getIconsBaseUri()}/icons/${isDark ? 'dark' : 'light'}/${iconFile}`
    })
}

// Applies a sort triggered from the VS Code native context menu
function onSortFromContextMenu (column: string, direction: 'asc' | 'desc'): void {
    sortColumn = column
    sortDirection = direction
    updateSortIndicators()
    notifyStateChanged()
    const col = columns.find((c: WorkspaceColumn) => c.name === column)
    announce(`Sorted by ${col?.label ?? column}, ${direction === 'asc' ? 'ascending' : 'descending'}`)
}

function setInputReadonly (input: HTMLInputElement): void {
    input.readOnly = true
    input.setAttribute('aria-hidden', 'true')
    input.setAttribute('role', 'none')
}

function clearInputReadonly (input: HTMLInputElement): void {
    input.readOnly = false
    input.removeAttribute('aria-hidden')
    input.removeAttribute('role')
}

// First click records a timestamp; second click enters edit mode only after a delay
function addEditClickHandler (input: HTMLInputElement): void {
    input.addEventListener('click', () => {
        const readyTime = Number(input.dataset.editReady ?? '0')
        if (readyTime > 0 && input.readOnly && Date.now() - readyTime >= EDIT_CLICK_DELAY_MS) {
            enterEditMode(input)
        } else if (readyTime === 0) {
            input.dataset.editReady = String(Date.now())
        }
    })
}

// Double-click opens the Variable Viewer
function addOpenOnDblClick (input: HTMLInputElement, varName: string): void {
    input.addEventListener('dblclick', () => {
        delete input.dataset.editReady
        vscodeApi.postMessage({ type: 'openVariable', variable: varName })
    })
}

// Only handle Enter/Escape when actively editing — let readonly state bubble to the document handler
function addEditKeyHandler (input: HTMLInputElement): void {
    input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (input.readOnly) return
        if (e.key === 'Enter') {
            e.stopPropagation()
            input.setSelectionRange(0, 0)
            input.blur();
            (input.closest('td') as HTMLElement)?.focus()
        } else if (e.key === 'Escape') {
            e.stopPropagation()
            announce('Edit cancelled')
            input.value = input.dataset.originalValue ?? ''
            input.setSelectionRange(0, 0)
            input.blur();
            (input.closest('td') as HTMLElement)?.focus()
        }
    })
}

// Transitions an input from readonly display to active edit mode.
// Stashes the current value for revert-on-Escape and selects all text.
function enterEditMode (input: HTMLInputElement): void {
    clearInputReadonly(input)
    input.dataset.originalValue = input.value
    input.focus()
    input.select()
    const label = input.classList.contains('wsb-name-input') ? 'name' : 'value'
    const varName = input.dataset.varName ?? ''
    announce(`Editing ${label} of ${varName}`)
}

// Focuses the Value input for a variable, entering edit mode
function onFocusValueInput (variable: string): void {
    const input = findValueInput(variable)
    if (input != null) {
        enterEditMode(input)
    }
}

// Focuses the Name input for a variable, entering edit mode
function onFocusNameInput (variable: string): void {
    const input = findNameInput(variable)
    if (input != null) {
        enterEditMode(input)
    }
}

// #endregion

// #region Table Construction

function updateSortIndicators (): void {
    const headers = document.querySelectorAll('.wsb-table thead th')
    for (const th of headers) {
        const colName = th.getAttribute('data-col')
        const icon = th.querySelector('.wsb-sort-icon')
        if (icon == null) continue

        if (colName === sortColumn) {
            th.classList.add('wsb-sorted')
            icon.textContent = sortDirection === 'asc' ? ' ▲' : ' ▼'
            th.setAttribute('aria-sort', sortDirection === 'asc' ? 'ascending' : 'descending')
        } else {
            th.classList.remove('wsb-sorted')
            icon.textContent = ' ▲'
            th.removeAttribute('aria-sort')
        }
    }
}

// #region Header Cell Creation

// Builds a single header cell: label, sort indicator, resizer handle, and persisted width
function createHeaderCell (col: WorkspaceColumn): HTMLTableCellElement {
    const th = document.createElement('th')
    th.setAttribute('role', 'columnheader')
    th.setAttribute('data-col', col.name)

    th.setAttribute('tabindex', '-1')

    if (col.sortable) {
        th.style.cursor = 'pointer'
        if (sortColumn === col.name) {
            th.setAttribute('aria-sort', sortDirection === 'asc' ? 'ascending' : 'descending')
        }
    }

    th.addEventListener('keydown', (e: KeyboardEvent) => {
        if ((e.key === 'Enter' || e.key === ' ') && col.sortable) {
            e.preventDefault()
            if (sortColumn === col.name) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'
            } else {
                sortColumn = col.name
                sortDirection = 'asc'
            }
            updateSortIndicators()
            notifyStateChanged()
            announce(`Sorted by ${col.label}, ${sortDirection === 'asc' ? 'ascending' : 'descending'}`)
        } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            const next = th.nextElementSibling as HTMLElement | null
            if (next != null) {
                focusedColName = next.getAttribute('data-col')
                next.focus()
            }
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault()
            const prev = th.previousElementSibling as HTMLElement | null
            if (prev != null) {
                focusedColName = prev.getAttribute('data-col')
                prev.focus()
            }
        }
    })

    // VS Code reads this attribute for context menu when clauses
    th.setAttribute('data-vscode-context', JSON.stringify({
        webviewSection: col.sortable ? 'header' : 'header-nosort',
        columnName: col.name,
        preventDefaultContextMenuItems: true
    }))

    const labelSpan = document.createElement('span')
    labelSpan.textContent = col.label
    th.appendChild(labelSpan)

    if (col.sortable) {
        const sortIcon = document.createElement('span')
        sortIcon.className = 'wsb-sort-icon'
        sortIcon.setAttribute('aria-hidden', 'true')
        if (sortColumn === col.name) {
            th.classList.add('wsb-sorted')
            sortIcon.textContent = sortDirection === 'asc' ? ' ▲' : ' ▼'
        } else {
            sortIcon.textContent = ' ▲'
        }
        th.appendChild(sortIcon)
    }

    if (col.resizable) {
        const resizerDiv = document.createElement('div')
        resizerDiv.className = 'wsb-resizer'
        resizerDiv.addEventListener('mousedown', (e: MouseEvent) => {
            startColumnResize(e, th, col.name)
        })
        th.appendChild(resizerDiv)
    }

    // Restore persisted width with triple-constraint to prevent table-layout rebalancing
    if (columnWidths[col.name] != null) {
        const w = `${columnWidths[col.name]}px`
        th.style.width = w
        th.style.minWidth = w
        th.style.maxWidth = w
        th.classList.add('wsb-manually-resized')
    }

    return th
}

// #endregion

// #region Data Row Creation

function createDataRow (row: WorkspaceVariable): HTMLTableRowElement {
    const tr = document.createElement('tr')
    tr.setAttribute('role', 'row')
    tr.setAttribute('data-var', row.name)

    // VS Code reads this attribute for context menu when clauses
    tr.setAttribute('data-vscode-context', JSON.stringify({
        webviewSection: 'row',
        varName: row.name,
        preventDefaultContextMenuItems: true
    }))

    if (row.name === selectedVarName) {
        tr.classList.add('wsb-selected')
        tr.setAttribute('aria-selected', 'true')
    } else {
        tr.setAttribute('aria-selected', 'false')
    }

    for (let i = 0; i < columns.length; i++) {
        const col = columns[i]
        const td = document.createElement('td')
        td.setAttribute('data-col', col.name)
        td.setAttribute('tabindex', '-1')
        td.setAttribute('aria-colindex', String(i + 1))

        td.setAttribute('role', 'gridcell')

        if (col.name === 'Name') {
            createNameCell(td, row)
        } else if (col.name === 'Value') {
            createValueCell(td, row)
        } else {
            createTextCell(td, row, col.name)
        }

        // Restore persisted width with triple-constraint to match header cells
        if (columnWidths[col.name] != null) {
            const w = `${columnWidths[col.name]}px`
            td.style.width = w
            td.style.minWidth = w
            td.style.maxWidth = w
        }

        tr.appendChild(td)
    }

    return tr
}

// Name column: type icon + editable input (click-when-focused enters edit mode, double-click opens Variable Viewer)
function createNameCell (td: HTMLTableCellElement, row: WorkspaceVariable): void {
    td.setAttribute('aria-label', row.name)
    td.setAttribute('aria-roledescription', 'editable cell')

    const iconLabel = document.createElement('div')
    iconLabel.className = 'wsb-icon-label'

    const img = document.createElement('img')
    img.className = 'wsb-icon'
    const iconFile = getIconFilename(row.fields.Class ?? '')
    const isDark = document.body.classList.contains('vscode-dark')
    img.src = `${getIconsBaseUri()}/icons/${isDark ? 'dark' : 'light'}/${iconFile}`
    img.alt = ''

    const input = document.createElement('input')
    input.type = 'text'
    input.size = 1
    input.className = 'wsb-name-input'
    input.tabIndex = -1
    input.value = row.name
    setInputReadonly(input)
    input.dataset.varName = row.name
    input.dataset.originalValue = row.name

    addEditClickHandler(input)
    addOpenOnDblClick(input, row.name)

    // Commit rename on blur if the name changed, then return to readonly
    input.addEventListener('blur', () => {
        delete input.dataset.editReady
        const newName = input.value.trim()
        const originalName = input.dataset.originalValue ?? ''
        input.classList.remove('wsb-value-error')
        setInputReadonly(input)

        // Reject empty names — revert without a server round-trip
        if (newName === '') {
            input.value = originalName
            return
        }

        if (newName !== originalName) {
            // Optimistically update the row's data attributes so context menu
            // actions target the new name before the server sends refreshed data
            const tr = input.closest('tr')
            if (tr != null) {
                tr.dataset.var = newName
                const context = JSON.parse(tr.getAttribute('data-vscode-context') ?? '{}')
                context.varName = newName
                tr.setAttribute('data-vscode-context', JSON.stringify(context))
            }
            input.dataset.varName = newName
            td.setAttribute('aria-label', newName)
            selectedVarName = newName
            pendingFocusRestore = true

            vscodeApi.postMessage({ type: 'renameVariable', variable: originalName, newName })
            announce(`Renamed to ${newName}`)
        }
    })

    addEditKeyHandler(input)

    iconLabel.appendChild(img)
    iconLabel.appendChild(input)
    td.appendChild(iconLabel)
}

// Value column: editable input (click-when-focused enters edit mode, double-click opens Variable Viewer)
function createValueCell (td: HTMLTableCellElement, row: WorkspaceVariable): void {
    td.setAttribute('aria-label', row.fields.Value ?? '')
    td.setAttribute('aria-roledescription', 'editable cell')

    const input = document.createElement('input')
    input.type = 'text'
    input.size = 1
    input.className = 'wsb-value-input'
    input.tabIndex = -1
    input.value = row.fields.Value ?? ''
    setInputReadonly(input)
    input.dataset.varName = row.name
    input.dataset.originalValue = row.fields.Value ?? ''

    addEditClickHandler(input)
    addOpenOnDblClick(input, row.name)

    // Commit edit on blur if the value changed, then return to readonly
    input.addEventListener('blur', () => {
        delete input.dataset.editReady
        const newValue = input.value
        const originalValue = input.dataset.originalValue ?? ''
        setInputReadonly(input)
        if (newValue !== originalValue) {
            td.setAttribute('aria-label', newValue)
            vscodeApi.postMessage({ type: 'editValue', variable: row.name, newValue })
            announce('Value changed')
        }
    })

    addEditKeyHandler(input)

    td.appendChild(input)
}

// Non-interactive columns (Class, Size): readonly input with size=1 for consistent table layout.
// Double-click opens the Variable Viewer for the row's variable.
function createTextCell (td: HTMLTableCellElement, row: WorkspaceVariable, colName: string): void {
    td.setAttribute('aria-label', row.fields[colName] ?? '')

    const input = document.createElement('input')
    input.type = 'text'
    input.size = 1
    input.className = 'wsb-text-input'
    setInputReadonly(input)
    input.tabIndex = -1
    input.value = row.fields[colName] ?? ''

    input.addEventListener('dblclick', () => {
        vscodeApi.postMessage({ type: 'openVariable', variable: row.name })
    })

    td.appendChild(input)
}

// #endregion

// #region Incremental DOM Patching

// Checks whether the incoming data can be patched in-place without a full rebuild.
// Data arrives pre-sorted from the extension host, so we compare row identity directly.
function canPatchInPlace (oldRows: WorkspaceVariable[], newRows: WorkspaceVariable[]): boolean {
    if (columns.length === 0) return false
    if (oldRows.length !== newRows.length) return false

    const tbody = document.querySelector('.wsb-table tbody')
    if (tbody == null || tbody.children.length !== oldRows.length) return false

    for (let i = 0; i < oldRows.length; i++) {
        if (oldRows[i].name !== newRows[i].name) return false
    }

    return true
}

// Patches individual cells in-place rather than rebuilding the entire table.
// Preserves active edit state by skipping focused value inputs.
function patchRows (sortedRows: WorkspaceVariable[]): void {
    const tbody = document.querySelector('.wsb-table tbody') as HTMLTableSectionElement
    if (tbody == null) return

    for (let i = 0; i < sortedRows.length; i++) {
        const row = sortedRows[i]
        const tr = tbody.children[i] as HTMLTableRowElement
        if (tr == null) continue

        for (const col of columns) {
            const td = tr.querySelector(`td[data-col="${CSS.escape(col.name)}"]`) as HTMLTableCellElement
            if (td == null) continue

            if (col.name === 'Name') {
                // Patch icon if the variable's class changed
                const img = td.querySelector<HTMLImageElement>('.wsb-icon')
                if (img != null) {
                    const iconFile = getIconFilename(row.fields.Class ?? '')
                    const isDark = document.body.classList.contains('vscode-dark')
                    const newSrc = `${getIconsBaseUri()}/icons/${isDark ? 'dark' : 'light'}/${iconFile}`
                    if (img.src !== newSrc) {
                        img.src = newSrc
                        img.alt = ''
                    }
                }
                // Skip patching name input if the user is actively editing
                const nameInput = td.querySelector<HTMLInputElement>('.wsb-name-input')
                if (nameInput != null && document.activeElement !== nameInput) {
                    if (nameInput.value !== row.name) {
                        nameInput.value = row.name
                        nameInput.dataset.originalValue = row.name
                        nameInput.dataset.varName = row.name
                        td.setAttribute('aria-label', row.name)
                    }
                }
            } else if (col.name === 'Value') {
                // Skip patching if the user is actively editing this input
                const input = td.querySelector<HTMLInputElement>('.wsb-value-input')
                if (input != null && document.activeElement !== input) {
                    const newValue = row.fields.Value ?? ''
                    if (input.value !== newValue) {
                        input.value = newValue
                        input.dataset.originalValue = newValue
                        td.setAttribute('aria-label', newValue)
                    }
                }
            } else {
                const newText = row.fields[col.name] ?? ''
                const input = td.querySelector<HTMLInputElement>('.wsb-text-input')
                if (input != null && input.value !== newText) {
                    input.value = newText
                    td.setAttribute('aria-label', newText)
                }
            }
        }
    }
}

// #endregion
// #endregion

// #region Event Handlers

// Suppress native text selection on multi-click (double-click) over readonly inputs.
// Without this, the second mousedown of a double-click selects the input text,
// causing a visible blue highlight flash before the dblclick handler fires.
function handleTableMouseDown (e: MouseEvent): void {
    if (e.detail < 2) return
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).readOnly) {
        e.preventDefault()
    }
}

function handleTableDblClick (e: MouseEvent): void {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT') return
    const tr = target.closest('tr[data-var]')
    if (tr != null) {
        const varName = tr.getAttribute('data-var')
        if (varName != null) {
            vscodeApi.postMessage({ type: 'openVariable', variable: varName })
        }
    }
}

// Delegated click handler for the table element
function handleTableClick (e: MouseEvent): void {
    const target = e.target as HTMLElement

    // Header click: toggle sort (skip if a resize is in progress — see startColumnResize)
    const th = target.closest('th')
    if (th != null) {
        if (resizing) return
        const colName = th.getAttribute('data-col')
        if (colName == null) return
        const col = columns.find((c: WorkspaceColumn) => c.name === colName)
        if (col == null || !col.sortable) return

        // Toggle direction if same column, otherwise start ascending
        if (sortColumn === colName) {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'
        } else {
            sortColumn = colName
            sortDirection = 'asc'
        }
        updateSortIndicators()
        notifyStateChanged()
        announce(`Sorted by ${col.label}, ${sortDirection === 'asc' ? 'ascending' : 'descending'}`)
        return
    }

    // Row click: select the row and focus the clicked cell
    const tr = target.closest('tr[data-var]')
    if (tr != null) {
        const varName = tr.getAttribute('data-var')
        if (varName != null) {
            selectRow(varName)
            if (target.tagName !== 'INPUT') {
                const td = target.closest('td[data-col]')
                const colName = td?.getAttribute('data-col') ?? firstColName()
                focusCell(tr, colName)
            }
        }
    }
}

// Manages focus-related CSS classes and syncs row selection when a cell receives focus
function handleFocusIn (e: FocusEvent): void {
    const target = e.target as HTMLElement
    const tr = target.closest('tr[data-var]')
    if (tr != null) {
        tr.classList.add('wsb-row-focused')
        tr.classList.remove('wsb-row-selected-unfocused')
        const varName = tr.getAttribute('data-var')
        if (varName != null) selectRow(varName)
    }
}

function handleFocusOut (e: FocusEvent): void {
    const target = e.target as HTMLElement
    const tr = target.closest('tr[data-var]')
    if (tr != null) {
        tr.classList.remove('wsb-row-focused')
        if (tr.classList.contains('wsb-selected')) {
            tr.classList.add('wsb-row-selected-unfocused')
        }
    }
}

// Dispatches keyboard shortcuts via the KEY_BINDINGS table
function handleDocumentKeydown (e: KeyboardEvent): void {
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
        const active = document.activeElement as HTMLElement | null
        const inTbody = active?.closest('tbody') != null
        const inThead = active?.closest('thead') != null
        const inStatusBar = active?.closest('.wsb-status-bar') != null

        const focusTbody = (): void => {
            const tbody = document.querySelector<HTMLElement>('.wsb-table tbody')
            tbody?.focus()
        }
        const focusHeader = (): void => {
            const targetCol = defaultColName()
            const th = document.querySelector<HTMLElement>(`.wsb-table thead th[data-col="${CSS.escape(targetCol)}"]`)
            if (th != null) {
                focusedColName = targetCol
                th.focus()
            }
        }
        const focusStatusLinkOrFallback = (fallback: () => void): void => {
            const statusLink = document.querySelector<HTMLElement>('.wsb-status-bar:not([style*="display: none"]) .wsb-status-link')
            if (statusLink != null) {
                statusLink.focus()
            } else {
                fallback()
            }
        }

        if (e.shiftKey) {
            if (inTbody) {
                e.preventDefault()
                focusStatusLinkOrFallback(focusHeader)
            } else if (inStatusBar) {
                e.preventDefault()
                focusHeader()
            } else if (inThead) {
                e.preventDefault()
                focusTbody()
            }
        } else {
            if (inTbody) {
                e.preventDefault()
                focusHeader()
            } else if (inThead) {
                e.preventDefault()
                focusStatusLinkOrFallback(focusTbody)
            } else if (inStatusBar) {
                e.preventDefault()
                focusTbody()
            }
        }
        return
    }

    const ctrl = e.ctrlKey || e.metaKey
    const binding = KEY_BINDINGS.find(
        b => b.key === e.key &&
            (b.ctrlKey === true ? ctrl : !ctrl) &&
            (b.guard == null || b.guard())
    )
    if (binding != null) {
        e.preventDefault()
        binding.action()
    }
}

// #endregion

// #region Row Selection

function selectRow (varName: string): void {
    // Remove selection from the previously selected row
    const prev = document.querySelector('.wsb-table tbody tr.wsb-selected')
    if (prev != null) {
        prev.classList.remove('wsb-selected')
        prev.setAttribute('aria-selected', 'false')
    }

    // Apply selection to the clicked row
    selectedVarName = varName
    const tr = document.querySelector(`.wsb-table tbody tr[data-var="${CSS.escape(varName)}"]`)
    if (tr != null) {
        tr.classList.add('wsb-selected')
        tr.setAttribute('aria-selected', 'true')
    }
}

// #endregion

// #region Column Resizing

function startColumnResize (e: MouseEvent, th: HTMLTableCellElement, colName: string): void {
    e.preventDefault()
    e.stopPropagation()
    resizing = true

    const startX = e.clientX
    const startW = th.offsetWidth
    // Use the stylesheet-defined minimum
    const minWidth = colName === 'Name' ? 65 : 55

    const onMouseMove = (moveEvent: MouseEvent): void => {
        const delta = moveEvent.clientX - startX
        const newWidth = Math.max(minWidth, startW + delta)

        // Pin all three width properties so table-layout:fixed cannot redistribute space
        th.style.width = `${newWidth}px`
        th.style.minWidth = `${newWidth}px`
        th.style.maxWidth = `${newWidth}px`
        th.classList.add('wsb-manually-resized')

        // Mirror the triple-constraint on all data cells in this column
        const cells = document.querySelectorAll(`.wsb-table td[data-col="${CSS.escape(colName)}"]`)
        cells.forEach((cell: Element) => {
            const cellEl = cell as HTMLElement
            cellEl.style.width = `${newWidth}px`
            cellEl.style.minWidth = `${newWidth}px`
            cellEl.style.maxWidth = `${newWidth}px`
        })
    }

    const onMouseUp = (): void => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)

        // Brief delay before clearing the resizing flag prevents
        // the sort click handler from firing during a resize
        setTimeout(() => { resizing = false }, 50)

        columnWidths[colName] = th.offsetWidth
        notifyStateChanged()
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
}

// #endregion

// #region Helpers

// Finds the value input element for a given variable name
function findValueInput (varName: string): HTMLInputElement | null {
    return document.querySelector(`.wsb-table tbody tr[data-var="${CSS.escape(varName)}"] .wsb-value-input`)
}

// Finds the name input element for a given variable name
function findNameInput (varName: string): HTMLInputElement | null {
    return document.querySelector(`.wsb-table tbody tr[data-var="${CSS.escape(varName)}"] .wsb-name-input`)
}

// Posts the current UI state to the extension for persistence
function notifyStateChanged (): void {
    vscodeApi.postMessage({
        type: 'stateChanged',
        state: { columnWidths, sortColumn, sortDirection }
    })
}

// #endregion
