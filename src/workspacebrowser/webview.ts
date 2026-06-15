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

// ── Module-Level State ───────────────────────────────────────────

let vscodeApi: VsCodeApi
let columns: WorkspaceColumn[] = []
let rows: WorkspaceVariable[] = []
let sortColumn: string = ''
let sortDirection: 'asc' | 'desc' = 'asc'
let columnWidths: Record<string, number> = {}
let selectedVarName: string | null = null
let resizing: boolean = false

// ── Keyboard Bindings ───────────────────────────────────────────

type KeyAction = () => void
type KeyGuard = () => boolean

interface KeyBinding {
    key: string
    action: KeyAction
    guard?: KeyGuard
}

function noInputEditing (): boolean {
    const active = document.activeElement as HTMLInputElement | null
    return !(active != null && active.tagName === 'INPUT' && !active.readOnly)
}

function deleteSelectedVariable (): void {
    if (selectedVarName == null) return
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
    const td = tr.querySelector(`td[data-col="${CSS.escape(colName)}"]`)
    const input = td?.querySelector('input') as HTMLInputElement | null
    if (input != null) {
        selectRow(tr.getAttribute('data-var')!)
        input.focus()
        tr.scrollIntoView?.({ block: 'nearest' })
    }
}

function moveDown (): void {
    const info = getFocusedCellInfo()
    if (info != null) {
        const next = info.tr.nextElementSibling
        if (next != null) focusCell(next, info.colName)
    } else {
        const first = document.querySelector('.wsb-table tbody tr')
        if (first != null) focusCell(first, columns[0]?.name ?? 'Name')
    }
}

function moveUp (): void {
    const info = getFocusedCellInfo()
    if (info != null) {
        const prev = info.tr.previousElementSibling
        if (prev != null) focusCell(prev, info.colName)
    } else {
        const first = document.querySelector('.wsb-table tbody tr')
        if (first != null) focusCell(first, columns[0]?.name ?? 'Name')
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
    const active = document.activeElement as HTMLInputElement | null
    if (active == null) return
    if (active.classList.contains('wsb-name-input') || active.classList.contains('wsb-value-input')) {
        if (active.readOnly) enterEditMode(active)
    }
}

function renameSelectedVariable (): void {
    if (selectedVarName == null) return
    const input = findNameInput(selectedVarName)
    if (input != null) enterEditMode(input)
}

const KEY_BINDINGS: KeyBinding[] = [
    { key: 'Delete', action: deleteSelectedVariable, guard: noInputEditing },
    { key: 'ArrowDown', action: moveDown, guard: noInputEditing },
    { key: 'ArrowUp', action: moveUp, guard: noInputEditing },
    { key: 'ArrowLeft', action: moveLeft, guard: noInputEditing },
    { key: 'ArrowRight', action: moveRight, guard: noInputEditing },
    { key: 'Enter', action: editFocusedCell, guard: noInputEditing },
    { key: 'F2', action: renameSelectedVariable, guard: noInputEditing }
]

// ── Exported Functions ───────────────────────────────────────────

// Called once by webview-main.ts to bind event listeners and signal readiness
export function init (api: VsCodeApi): void {
    vscodeApi = api

    // Bind event delegation on the pre-existing table element created by the provider HTML
    const table = document.querySelector('.wsb-table') as HTMLTableElement
    if (table != null) {
        table.addEventListener('click', handleTableClick)
        table.addEventListener('focusin', handleFocusIn)
        table.addEventListener('focusout', handleFocusOut)
    }

    // Handle keyboard shortcuts via the dispatch table
    document.addEventListener('keydown', handleDocumentKeydown)

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

    // ── Build Header Row ─────────────────────────────────────────
    const headerRow = document.createElement('tr')
    for (const col of columns) {
        headerRow.appendChild(createHeaderCell(col))
    }
    thead.appendChild(headerRow)

    // ── Build Data Rows ──────────────────────────────────────────
    for (const row of rows) {
        const tr = createDataRow(row)
        tbody.appendChild(tr)
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
} {
    return { columns, rows, sortColumn, sortDirection, columnWidths, selectedVarName }
}

// ── Message Handlers ─────────────────────────────────────────────

function onSetData (newRows: WorkspaceVariable[]): void {
    const oldRows = rows
    rows = newRows

    if (canPatchInPlace(oldRows, newRows)) {
        patchRows(newRows)
    } else {
        renderTable()
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
}

// Transitions an input from readonly display to active edit mode.
// Stashes the current value for revert-on-Escape and selects all text.
function enterEditMode (input: HTMLInputElement): void {
    input.readOnly = false
    input.dataset.originalValue = input.value
    input.focus()
    input.select()
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

// ── Header Sort Indicator Update ─────────────────────────────────

function updateSortIndicators (): void {
    const headers = document.querySelectorAll('.wsb-table thead th')
    for (const th of headers) {
        const colName = th.getAttribute('data-col')
        const icon = th.querySelector('.wsb-sort-icon')
        if (icon == null) continue

        if (colName === sortColumn) {
            th.classList.add('wsb-sorted')
            icon.textContent = sortDirection === 'asc' ? ' ▲' : ' ▼'
        } else {
            th.classList.remove('wsb-sorted')
            icon.textContent = ' ▲'
        }
    }
}

// ── Header Cell Creation ─────────────────────────────────────────

// Builds a single header cell: label, sort indicator, resizer handle, and persisted width
function createHeaderCell (col: WorkspaceColumn): HTMLTableCellElement {
    const th = document.createElement('th')
    th.setAttribute('data-col', col.name)

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

// ── Data Row Creation ────────────────────────────────────────────

function createDataRow (row: WorkspaceVariable): HTMLTableRowElement {
    const tr = document.createElement('tr')
    tr.setAttribute('data-var', row.name)

    // VS Code reads this attribute for context menu when clauses
    tr.setAttribute('data-vscode-context', JSON.stringify({
        webviewSection: 'row',
        varName: row.name,
        preventDefaultContextMenuItems: true
    }))

    if (row.name === selectedVarName) {
        tr.classList.add('wsb-selected')
    }

    for (const col of columns) {
        const td = document.createElement('td')
        td.setAttribute('data-col', col.name)

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

// Name column: type icon + editable input (readonly until double-click or context menu)
function createNameCell (td: HTMLTableCellElement, row: WorkspaceVariable): void {
    const iconLabel = document.createElement('div')
    iconLabel.className = 'wsb-icon-label'

    const img = document.createElement('img')
    img.className = 'wsb-icon'
    const iconFile = getIconFilename(row.fields.Class ?? '')
    const isDark = document.body.classList.contains('vscode-dark')
    img.src = `${getIconsBaseUri()}/icons/${isDark ? 'dark' : 'light'}/${iconFile}`
    img.alt = row.fields.Class ?? ''

    const input = document.createElement('input')
    input.type = 'text'
    input.size = 1
    input.className = 'wsb-name-input'
    input.value = row.name
    input.readOnly = true
    input.dataset.varName = row.name
    input.dataset.originalValue = row.name

    // Double-click enters edit mode
    input.addEventListener('dblclick', () => {
        enterEditMode(input)
    })

    // Commit rename on blur if the name changed, then return to readonly
    input.addEventListener('blur', () => {
        const newName = input.value.trim()
        const originalName = input.dataset.originalValue ?? ''
        input.classList.remove('wsb-value-error')
        input.readOnly = true

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

            vscodeApi.postMessage({ type: 'renameVariable', variable: originalName, newName })
        }
    })

    // Only handle Enter/Escape when actively editing — let readonly state bubble to the document handler
    input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (input.readOnly) return
        if (e.key === 'Enter') {
            e.stopPropagation()
            input.blur()
        } else if (e.key === 'Escape') {
            e.stopPropagation()
            input.value = input.dataset.originalValue ?? ''
            input.blur()
        }
    })

    iconLabel.appendChild(img)
    iconLabel.appendChild(input)
    td.appendChild(iconLabel)
}

// Value column: editable input (readonly until double-click or context menu)
function createValueCell (td: HTMLTableCellElement, row: WorkspaceVariable): void {
    const input = document.createElement('input')
    input.type = 'text'
    input.size = 1
    input.className = 'wsb-value-input'
    input.value = row.fields.Value ?? ''
    input.readOnly = true
    input.dataset.varName = row.name
    input.dataset.originalValue = row.fields.Value ?? ''

    // Double-click enters edit mode
    input.addEventListener('dblclick', () => {
        enterEditMode(input)
    })

    // Commit edit on blur if the value changed, then return to readonly
    input.addEventListener('blur', () => {
        const newValue = input.value
        const originalValue = input.dataset.originalValue ?? ''
        input.readOnly = true
        if (newValue !== originalValue) {
            vscodeApi.postMessage({ type: 'editValue', variable: row.name, newValue })
        }
    })

    // Only handle Enter/Escape when actively editing — let readonly state bubble to the document handler
    input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (input.readOnly) return
        if (e.key === 'Enter') {
            e.stopPropagation()
            input.blur()
        } else if (e.key === 'Escape') {
            e.stopPropagation()
            input.value = input.dataset.originalValue ?? ''
            input.blur()
        }
    })

    td.appendChild(input)
}

// Non-interactive columns (Class, Size): readonly input with size=1 for consistent table layout
function createTextCell (td: HTMLTableCellElement, row: WorkspaceVariable, colName: string): void {
    const input = document.createElement('input')
    input.type = 'text'
    input.size = 1
    input.className = 'wsb-text-input'
    input.readOnly = true
    input.tabIndex = -1
    input.value = row.fields[colName] ?? ''
    td.appendChild(input)
}

// ── Incremental DOM Patching ─────────────────────────────────────

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
                        img.alt = row.fields.Class ?? ''
                    }
                }
                // Skip patching name input if the user is actively editing
                const nameInput = td.querySelector<HTMLInputElement>('.wsb-name-input')
                if (nameInput != null && document.activeElement !== nameInput) {
                    if (nameInput.value !== row.name) {
                        nameInput.value = row.name
                        nameInput.dataset.originalValue = row.name
                        nameInput.dataset.varName = row.name
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
                    }
                }
            } else {
                const newText = row.fields[col.name] ?? ''
                const input = td.querySelector<HTMLInputElement>('.wsb-text-input')
                if (input != null && input.value !== newText) {
                    input.value = newText
                }
            }
        }
    }
}

// ── Event Handlers ───────────────────────────────────────────────

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
        return
    }

    // Row click: select the row
    const tr = target.closest('tr[data-var]')
    if (tr != null) {
        const varName = tr.getAttribute('data-var')
        if (varName != null) {
            selectRow(varName)
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
    const binding = KEY_BINDINGS.find(
        b => b.key === e.key && (b.guard == null || b.guard())
    )
    if (binding != null) {
        e.preventDefault()
        binding.action()
    }
}

// ── Row Selection ────────────────────────────────────────────────

function selectRow (varName: string): void {
    // Remove selection from the previously selected row
    const prev = document.querySelector('.wsb-table tbody tr.wsb-selected')
    if (prev != null) {
        prev.classList.remove('wsb-selected')
    }

    // Apply selection to the clicked row
    selectedVarName = varName
    const tr = document.querySelector(`.wsb-table tbody tr[data-var="${CSS.escape(varName)}"]`)
    if (tr != null) {
        tr.classList.add('wsb-selected')
    }
}

// ── Column Resizing ──────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────

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
