// Copyright 2026 The MathWorks, Inc.

// Tests for the webview module — drives the real production code against jsdom
// by injecting a mock VsCodeApi via init(). Each test sets up a DOM skeleton,
// exercises the module through handleMessage() and simulated events, then asserts
// against DOM state and captured messages.

import { expect } from 'chai'
import * as sinon from 'sinon'
import { init, handleMessage, resetState, getState } from '../../workspacebrowser/webview'
import { WorkspaceVariable, WorkspaceColumn, WebviewToExt } from '../../workspacebrowser/types'

// ── Helpers ──────────────────────────────────────────────────────

// Captured messages posted to the extension host by the webview
let postedMessages: WebviewToExt[] = []

// Mock VsCodeApi that records messages for assertion
const mockApi = {
    postMessage: (msg: WebviewToExt) => { postedMessages.push(msg) }
}

// Standard columns matching the four workspace browser fields
const testColumns: WorkspaceColumn[] = [
    { name: 'Name', label: 'Name', sortable: true, resizable: true },
    { name: 'Class', label: 'Class', sortable: true, resizable: true },
    { name: 'Size', label: 'Size', sortable: true, resizable: true },
    { name: 'Value', label: 'Value', sortable: false, resizable: true }
]

// Sample workspace variables for testing
const testRows: WorkspaceVariable[] = [
    { name: 'alpha', fields: { Name: 'alpha', Class: 'double', Size: '1x1', Value: '3.14' } },
    { name: 'beta', fields: { Name: 'beta', Class: 'char', Size: '1x5', Value: "'hello'" } },
    { name: 'gamma', fields: { Name: 'gamma', Class: 'struct', Size: '1x1', Value: '1x1 struct' } }
]

// Creates the DOM skeleton that the provider HTML would produce
function setupDOM (): void {
    document.body.innerHTML = `
        <div class="wsb-container">
            <div class="wsb-table-wrap">
                <table class="wsb-table">
                    <thead></thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
    `
}

// Sends columns and data to the webview to populate the table
function populateTable (): void {
    handleMessage({ type: 'setColumns', columns: testColumns })
    handleMessage({ type: 'setData', rows: testRows })
}

// ── Test Suites ──────────────────────────────────────────────────

suite('webview', () => {
    setup(() => {
        postedMessages = []
        resetState()
        setupDOM()
    })

    teardown(() => {
        resetState()
        document.body.innerHTML = ''
        sinon.restore()
    })

    // ── init ─────────────────────────────────────────────────────
    // The init function is the bootstrap entry point for the webview. It must
    // post a 'ready' message so the extension host knows it can start sending
    // cached data. Without this, the provider would wait indefinitely.

    suite('init', () => {
        test('posts ready message to signal the extension host', () => {
            init(mockApi)
            const readyMsg = postedMessages.find(m => m.type === 'ready')
            expect(readyMsg).to.not.be.undefined
        })
    })

    // ── renderTable ──────────────────────────────────────────────
    // renderTable is the core rendering function that builds the full DOM from
    // module state. These tests verify the structural correctness of the output:
    // header cells, data rows, data-vscode-context attributes (required for
    // native context menus), icon/label layout, value inputs, resize handles,
    // and sort indicators. A regression here would break the entire UI.

    suite('renderTable', () => {
        setup(() => {
            init(mockApi)
            postedMessages = []
        })

        test('builds header row with correct column names', () => {
            populateTable()
            const headers = document.querySelectorAll('.wsb-table thead th')
            expect(headers.length).to.equal(4)
            expect(headers[0].getAttribute('data-col')).to.equal('Name')
            expect(headers[3].getAttribute('data-col')).to.equal('Value')
        })

        test('builds data rows matching the number of variables', () => {
            populateTable()
            const rows = document.querySelectorAll('.wsb-table tbody tr')
            expect(rows.length).to.equal(3)
        })

        test('sets data-vscode-context on header cells for context menu', () => {
            populateTable()
            const th = document.querySelector('th[data-col="Name"]') as HTMLTableCellElement
            const context = JSON.parse(th.getAttribute('data-vscode-context') ?? '{}')
            expect(context.webviewSection).to.equal('header')
            expect(context.columnName).to.equal('Name')
            expect(context.preventDefaultContextMenuItems).to.equal(true)
        })

        test('sets data-vscode-context on data rows for context menu', () => {
            populateTable()
            const tr = document.querySelector('tr[data-var="alpha"]') as HTMLTableRowElement
            const context = JSON.parse(tr.getAttribute('data-vscode-context') ?? '{}')
            expect(context.webviewSection).to.equal('row')
            expect(context.varName).to.equal('alpha')
            expect(context.preventDefaultContextMenuItems).to.equal(true)
        })

        test('renders header when columns arrive but no data rows exist yet', () => {
            handleMessage({ type: 'setColumns', columns: testColumns })
            const headers = document.querySelectorAll('.wsb-table thead th')
            expect(headers.length).to.equal(4)
            const dataRows = document.querySelectorAll('.wsb-table tbody tr')
            expect(dataRows.length).to.equal(0)
        })

        test('Name column contains icon image and name input', () => {
            populateTable()
            const nameCell = document.querySelector('tr[data-var="alpha"] td[data-col="Name"]') as HTMLTableCellElement
            const img = nameCell.querySelector('.wsb-icon') as HTMLImageElement
            const input = nameCell.querySelector('.wsb-name-input') as HTMLInputElement
            expect(img).to.not.be.null
            expect(input).to.not.be.null
            expect(input.value).to.equal('alpha')
            expect(input.readOnly).to.be.true
        })

        test('Value column contains a readonly input that becomes editable on double-click', () => {
            populateTable()
            const input = document.querySelector('tr[data-var="alpha"] .wsb-value-input') as HTMLInputElement
            expect(input).to.not.be.null
            expect(input.value).to.equal('3.14')
            expect(input.readOnly).to.be.true

            input.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            expect(input.readOnly).to.be.false
        })

        test('resizer divs are appended to resizable header cells', () => {
            populateTable()
            const resizers = document.querySelectorAll('.wsb-resizer')
            // All 4 columns are resizable in our test data
            expect(resizers.length).to.equal(4)
        })

        test('sort indicator is shown on the sorted column', () => {
            handleMessage({ type: 'setColumns', columns: testColumns })
            handleMessage({ type: 'setState', state: { sortColumn: 'Name', sortDirection: 'asc' } })
            handleMessage({ type: 'setData', rows: testRows })

            const nameTh = document.querySelector('th[data-col="Name"]') as HTMLTableCellElement
            expect(nameTh.classList.contains('wsb-sorted')).to.be.true
            const sortIcon = nameTh.querySelector('.wsb-sort-icon') as HTMLSpanElement
            expect(sortIcon.textContent).to.include('▲')
        })

        test('applies persisted column widths from state', () => {
            handleMessage({ type: 'setColumns', columns: testColumns })
            handleMessage({ type: 'setState', state: { columnWidths: { Name: 120 } } })
            handleMessage({ type: 'setData', rows: testRows })

            const nameTh = document.querySelector('th[data-col="Name"]') as HTMLTableCellElement
            expect(nameTh.style.width).to.equal('120px')
            expect(nameTh.classList.contains('wsb-manually-resized')).to.be.true
        })

        test('does not render rows when no columns are set', () => {
            handleMessage({ type: 'setData', rows: testRows })
            const rows = document.querySelectorAll('.wsb-table tbody tr')
            expect(rows.length).to.equal(0)
        })
    })

    // ── Row selection ────────────────────────────────────────────
    // Row selection drives the context menu — the selected variable is the
    // target of the "Edit Value" action. The wsb-selected class also provides
    // visual feedback. These tests ensure single-selection semantics: clicking
    // a new row must deselect the previous one.

    suite('row selection', () => {
        setup(() => {
            init(mockApi)
            populateTable()
            postedMessages = []
        })

        test('clicking a row adds wsb-selected class', () => {
            const tr = document.querySelector('tr[data-var="alpha"]') as HTMLTableRowElement
            tr.click()
            expect(tr.classList.contains('wsb-selected')).to.be.true
        })

        test('clicking a different row moves the selection', () => {
            const tr1 = document.querySelector('tr[data-var="alpha"]') as HTMLTableRowElement
            const tr2 = document.querySelector('tr[data-var="beta"]') as HTMLTableRowElement
            tr1.click()
            tr2.click()
            expect(tr1.classList.contains('wsb-selected')).to.be.false
            expect(tr2.classList.contains('wsb-selected')).to.be.true
        })

        test('updates selectedVarName in module state', () => {
            const tr = document.querySelector('tr[data-var="gamma"]') as HTMLTableRowElement
            tr.click()
            expect(getState().selectedVarName).to.equal('gamma')
        })
    })

    // ── Sort interaction ─────────────────────────────────────────
    // Header clicks toggle column sorting with instant feedback (no server
    // round-trip). The sort state must be persisted via stateChanged so it
    // survives webview disposal. Non-sortable columns (Value) must be no-ops
    // because the server cannot sort by computed display values.

    suite('sort interaction via header click', () => {
        setup(() => {
            init(mockApi)
            populateTable()
            postedMessages = []
        })

        test('clicking a sortable header sets sort column and posts stateChanged', () => {
            const nameTh = document.querySelector('th[data-col="Name"]') as HTMLTableCellElement
            nameTh.click()
            expect(getState().sortColumn).to.equal('Name')
            expect(getState().sortDirection).to.equal('asc')

            const stateMsg = postedMessages.find(m => m.type === 'stateChanged')
            expect(stateMsg).to.not.be.undefined
        })

        test('clicking the same header again toggles direction to desc', () => {
            // Re-query after first click because renderTable() rebuilds the DOM
            const nameTh1 = document.querySelector('th[data-col="Name"]') as HTMLTableCellElement
            nameTh1.click()
            const nameTh2 = document.querySelector('th[data-col="Name"]') as HTMLTableCellElement
            nameTh2.click()
            expect(getState().sortDirection).to.equal('desc')
        })

        test('clicking a non-sortable header (Value) does not change sort state', () => {
            const valueTh = document.querySelector('th[data-col="Value"]') as HTMLTableCellElement
            valueTh.click()
            expect(getState().sortColumn).to.equal('')
        })
    })

    // ── Value editing ────────────────────────────────────────────
    // Inline value editing lets users assign new values to MATLAB variables
    // directly from the workspace browser. The edit flow must:
    // - Require a double-click to enter edit mode (single click selects the row)
    // - Only post editValue when the value actually changed (avoid no-op fevals)
    // - Support Escape to revert without committing
    // - Return to readonly on blur
    // A bug here would cause silent data loss or unnecessary server traffic.

    suite('value editing', () => {
        setup(() => {
            init(mockApi)
            populateTable()
            postedMessages = []
        })

        test('double-click enters edit mode then blur with changed value posts editValue', () => {
            const input = document.querySelector('tr[data-var="alpha"] .wsb-value-input') as HTMLInputElement
            input.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            expect(input.readOnly).to.be.false

            input.value = '42'
            input.blur()

            expect(input.readOnly).to.be.true
            const editMsg = postedMessages.find(m => m.type === 'editValue')
            expect(editMsg).to.not.be.undefined
            if (editMsg != null && editMsg.type === 'editValue') {
                expect(editMsg.variable).to.equal('alpha')
                expect(editMsg.newValue).to.equal('42')
            }
        })

        test('blur with unchanged value does not post editValue', () => {
            const input = document.querySelector('tr[data-var="alpha"] .wsb-value-input') as HTMLInputElement
            input.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            input.blur()

            const editMsg = postedMessages.find(m => m.type === 'editValue')
            expect(editMsg).to.be.undefined
        })

        test('Escape key reverts the value to original', () => {
            const input = document.querySelector('tr[data-var="alpha"] .wsb-value-input') as HTMLInputElement
            input.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            input.value = '999'
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            expect(input.value).to.equal('3.14')
        })
    })

    // ── Error display ────────────────────────────────────────────
    // When an feval operation fails (e.g. invalid assignment syntax), the error
    // must be shown inline at the element the user was interacting with, not as
    // a modal dialog. For editValue errors, the input must revert to the original
    // value and show a transient red border so the user sees the failure without
    // losing their place in the table.

    suite('error display', () => {
        let clock: sinon.SinonFakeTimers

        setup(() => {
            clock = sinon.useFakeTimers()
            init(mockApi)
            populateTable()
            postedMessages = []
        })

        teardown(() => {
            clock.restore()
        })

        test('editValue error reverts input and applies error class', () => {
            const input = document.querySelector('tr[data-var="alpha"] .wsb-value-input') as HTMLInputElement
            input.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            input.dataset.originalValue = '3.14'
            input.value = 'bad_value'

            handleMessage({
                type: 'operationError',
                operation: 'editValue',
                variable: 'alpha',
                message: 'Error'
            })

            expect(input.value).to.equal('3.14')
            expect(input.classList.contains('wsb-value-error')).to.be.true

            // Error class is removed after 2 seconds
            clock.tick(2000)
            expect(input.classList.contains('wsb-value-error')).to.be.false
        })
    })

    // ── Name editing (rename) ───────────────────────────────────
    // Inline name editing lets users rename MATLAB variables directly from the
    // workspace browser. Like value editing, it requires double-click to enter
    // edit mode and validates against duplicate names client-side.

    suite('name editing', () => {
        setup(() => {
            init(mockApi)
            populateTable()
            postedMessages = []
        })

        test('double-click enters edit mode then blur with changed name posts renameVariable', () => {
            const input = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
            input.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            expect(input.readOnly).to.be.false

            input.value = 'delta'
            input.blur()

            expect(input.readOnly).to.be.true
            const renameMsg = postedMessages.find(m => m.type === 'renameVariable')
            expect(renameMsg).to.not.be.undefined
            if (renameMsg != null && renameMsg.type === 'renameVariable') {
                expect(renameMsg.variable).to.equal('alpha')
                expect(renameMsg.newName).to.equal('delta')
            }
        })

        test('blur with unchanged name does not post renameVariable', () => {
            const input = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
            input.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            input.blur()

            const renameMsg = postedMessages.find(m => m.type === 'renameVariable')
            expect(renameMsg).to.be.undefined
        })

        test('Escape key reverts the name to original', () => {
            const input = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
            input.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            input.value = 'newname'
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            expect(input.value).to.equal('alpha')
        })

        test('duplicate name posts renameVariable to extension for server-side validation', () => {
            const input = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
            input.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            input.value = 'beta'
            input.blur()

            const renameMsg = postedMessages.find(m => m.type === 'renameVariable')
            expect(renameMsg).to.not.be.undefined
        })

        test('rename operationError reverts name input and applies error class', () => {
            const input = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
            input.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            input.dataset.originalValue = 'alpha'
            input.value = 'badname'

            handleMessage({
                type: 'operationError',
                operation: 'rename',
                variable: 'alpha',
                message: 'Error'
            })

            expect(input.value).to.equal('alpha')
            expect(input.classList.contains('wsb-value-error')).to.be.true
        })
    })

    // ── Incremental patching ─────────────────────────────────────
    // When the server sends updated data and the row set is structurally unchanged
    // (same variable names, same count), individual cells are patched in place
    // rather than rebuilding the entire table. This preserves the user's active
    // edit state, tooltip hover, and selection without coordination logic.
    // If the row set changes structurally (added/removed/renamed variables),
    // patching must fall back to a full rebuild to avoid stale DOM nodes.

    suite('incremental DOM patching', () => {
        setup(() => {
            init(mockApi)
            populateTable()
            postedMessages = []
        })

        test('patches cell values in place when row set is unchanged', () => {
            // Send updated data with same variable names but different values
            const updatedRows: WorkspaceVariable[] = [
                { name: 'alpha', fields: { Name: 'alpha', Class: 'double', Size: '1x1', Value: '6.28' } },
                { name: 'beta', fields: { Name: 'beta', Class: 'char', Size: '1x5', Value: "'world'" } },
                { name: 'gamma', fields: { Name: 'gamma', Class: 'struct', Size: '1x1', Value: '1x1 struct' } }
            ]
            handleMessage({ type: 'setData', rows: updatedRows })

            const input = document.querySelector('tr[data-var="alpha"] .wsb-value-input') as HTMLInputElement
            expect(input.value).to.equal('6.28')
        })

        test('falls back to full rebuild when row count changes', () => {
            const fewerRows: WorkspaceVariable[] = [
                { name: 'alpha', fields: { Name: 'alpha', Class: 'double', Size: '1x1', Value: '3.14' } }
            ]
            handleMessage({ type: 'setData', rows: fewerRows })

            const rows = document.querySelectorAll('.wsb-table tbody tr')
            expect(rows.length).to.equal(1)
        })

        test('falls back to full rebuild when variable names change', () => {
            const renamedRows: WorkspaceVariable[] = [
                { name: 'delta', fields: { Name: 'delta', Class: 'double', Size: '1x1', Value: '1.0' } },
                { name: 'beta', fields: { Name: 'beta', Class: 'char', Size: '1x5', Value: "'hello'" } },
                { name: 'gamma', fields: { Name: 'gamma', Class: 'struct', Size: '1x1', Value: '1x1 struct' } }
            ]
            handleMessage({ type: 'setData', rows: renamedRows })

            const firstRow = document.querySelector('.wsb-table tbody tr') as HTMLTableRowElement
            expect(firstRow.getAttribute('data-var')).to.not.be.null
        })
    })

    // ── State application ────────────────────────────────────────
    // UI state (column widths, sort preferences) is persisted to workspaceState
    // and sent back to the webview on 'ready'. These tests ensure that the
    // webview correctly applies restored state so column widths and sort order
    // survive webview disposal and MATLAB reconnection.

    suite('state application', () => {
        setup(() => {
            init(mockApi)
        })

        test('setState message applies sort column and direction', () => {
            handleMessage({ type: 'setColumns', columns: testColumns })
            handleMessage({ type: 'setState', state: { sortColumn: 'Class', sortDirection: 'desc' } })
            handleMessage({ type: 'setData', rows: testRows })

            const state = getState()
            expect(state.sortColumn).to.equal('Class')
            expect(state.sortDirection).to.equal('desc')
        })

        test('setState message applies column widths', () => {
            handleMessage({ type: 'setColumns', columns: testColumns })
            handleMessage({ type: 'setState', state: { columnWidths: { Size: 100 } } })
            handleMessage({ type: 'setData', rows: testRows })

            expect(getState().columnWidths).to.deep.include({ Size: 100 })
        })
    })

    // ── Context menu sort ────────────────────────────────────────
    // VS Code native context menus dispatch sort commands via the extension host,
    // which posts sortFromContextMenu to the webview. This is a separate code
    // path from header clicks and must also update sort state, re-render, and
    // persist the change. Without this, context menu sort items would appear
    // to do nothing.

    suite('context menu sort', () => {
        setup(() => {
            init(mockApi)
            populateTable()
            postedMessages = []
        })

        test('sortFromContextMenu updates sort state and re-renders', () => {
            handleMessage({ type: 'sortFromContextMenu', column: 'Size', direction: 'desc' })

            const state = getState()
            expect(state.sortColumn).to.equal('Size')
            expect(state.sortDirection).to.equal('desc')

            // Should post stateChanged to persist the sort preference
            const stateMsg = postedMessages.find(m => m.type === 'stateChanged')
            expect(stateMsg).to.not.be.undefined
        })
    })

    // ── Delete key ──────────────────────────────────────────────────
    // The Delete key should trigger variable deletion when a row is selected
    // and no input is in edit mode. This mirrors the context menu delete flow
    // and must not interfere with text editing in name/value inputs.

    suite('delete key', () => {
        setup(() => {
            init(mockApi)
            populateTable()
            postedMessages = []
        })

        test('pressing Delete with a selected row posts deleteVariable message', () => {
            const tr = document.querySelector('tr[data-var="alpha"]') as HTMLTableRowElement
            tr.click()
            postedMessages = []

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))

            const deleteMsg = postedMessages.find(m => m.type === 'deleteVariable')
            expect(deleteMsg).to.not.be.undefined
            if (deleteMsg != null && deleteMsg.type === 'deleteVariable') {
                expect(deleteMsg.variable).to.equal('alpha')
            }
        })

        test('pressing Delete with no selected row does nothing', () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))

            const deleteMsg = postedMessages.find(m => m.type === 'deleteVariable')
            expect(deleteMsg).to.be.undefined
        })

        test('pressing Delete while editing a name input does not post deleteVariable', () => {
            const tr = document.querySelector('tr[data-var="alpha"]') as HTMLTableRowElement
            tr.click()

            // Enter edit mode on the name input
            const nameInput = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
            nameInput.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            expect(nameInput.readOnly).to.be.false
            nameInput.focus()
            postedMessages = []

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))

            const deleteMsg = postedMessages.find(m => m.type === 'deleteVariable')
            expect(deleteMsg).to.be.undefined
        })

        test('pressing Delete while editing a value input does not post deleteVariable', () => {
            const tr = document.querySelector('tr[data-var="alpha"]') as HTMLTableRowElement
            tr.click()

            // Enter edit mode on the value input
            const valueInput = document.querySelector('tr[data-var="alpha"] .wsb-value-input') as HTMLInputElement
            valueInput.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            expect(valueInput.readOnly).to.be.false
            valueInput.focus()
            postedMessages = []

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))

            const deleteMsg = postedMessages.find(m => m.type === 'deleteVariable')
            expect(deleteMsg).to.be.undefined
        })

        test('pressing Delete with a readonly input focused posts deleteVariable', () => {
            const tr = document.querySelector('tr[data-var="beta"]') as HTMLTableRowElement
            tr.click()

            // Focus a readonly text input (Class/Size column)
            const textInput = document.querySelector('tr[data-var="beta"] .wsb-text-input') as HTMLInputElement
            textInput.focus()
            postedMessages = []

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))

            const deleteMsg = postedMessages.find(m => m.type === 'deleteVariable')
            expect(deleteMsg).to.not.be.undefined
            if (deleteMsg != null && deleteMsg.type === 'deleteVariable') {
                expect(deleteMsg.variable).to.equal('beta')
            }
        })

        test('pressing Backspace does not trigger delete', () => {
            const tr = document.querySelector('tr[data-var="alpha"]') as HTMLTableRowElement
            tr.click()
            postedMessages = []

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))

            const deleteMsg = postedMessages.find(m => m.type === 'deleteVariable')
            expect(deleteMsg).to.be.undefined
        })

        test('pressing other keys does not trigger delete', () => {
            const tr = document.querySelector('tr[data-var="alpha"]') as HTMLTableRowElement
            tr.click()
            postedMessages = []

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))

            const deleteMsg = postedMessages.find(m => m.type === 'deleteVariable')
            expect(deleteMsg).to.be.undefined
        })
    })

    // ── Arrow key navigation ────────────────────────────────────────
    // Arrow keys provide cell-based grid navigation. Up/Down move to the same
    // column in adjacent rows. Left/Right move between columns in the same row.
    // Navigation is blocked when an input is in edit mode.

    suite('arrow key navigation', () => {
        setup(() => {
            init(mockApi)
            populateTable()
            postedMessages = []
        })

        test('ArrowDown with no focus selects the first row, first column', () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))

            const state = getState()
            expect(state.selectedVarName).to.equal('alpha')
        })

        test('ArrowUp with no focus selects the first row', () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))

            const state = getState()
            expect(state.selectedVarName).to.equal('alpha')
        })

        test('ArrowDown moves focus to same column in next row', () => {
            const nameInput = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
            nameInput.focus()

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))

            const state = getState()
            expect(state.selectedVarName).to.equal('beta')
            const focused = document.activeElement as HTMLInputElement
            expect(focused.classList.contains('wsb-name-input')).to.be.true
            expect(focused.closest('tr')?.getAttribute('data-var')).to.equal('beta')
        })

        test('ArrowUp moves focus to same column in previous row', () => {
            const nameInput = document.querySelector('tr[data-var="beta"] .wsb-name-input') as HTMLInputElement
            nameInput.focus()

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))

            const state = getState()
            expect(state.selectedVarName).to.equal('alpha')
            const focused = document.activeElement as HTMLInputElement
            expect(focused.closest('tr')?.getAttribute('data-var')).to.equal('alpha')
        })

        test('ArrowDown on the last row is a no-op', () => {
            const input = document.querySelector('tr[data-var="gamma"] .wsb-name-input') as HTMLInputElement
            input.focus()

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))

            const state = getState()
            expect(state.selectedVarName).to.equal('gamma')
        })

        test('ArrowUp on the first row is a no-op', () => {
            const input = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
            input.focus()

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))

            const state = getState()
            expect(state.selectedVarName).to.equal('alpha')
        })

        test('ArrowRight moves focus to next column in same row', () => {
            const nameInput = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
            nameInput.focus()

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

            const focused = document.activeElement as HTMLInputElement
            expect(focused.closest('td')?.getAttribute('data-col')).to.equal('Class')
        })

        test('ArrowLeft moves focus to previous column in same row', () => {
            const valueInput = document.querySelector('tr[data-var="alpha"] .wsb-value-input') as HTMLInputElement
            valueInput.focus()

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))

            const focused = document.activeElement as HTMLInputElement
            expect(focused.closest('td')?.getAttribute('data-col')).to.equal('Size')
        })

        test('ArrowRight on the last column is a no-op', () => {
            const valueInput = document.querySelector('tr[data-var="alpha"] .wsb-value-input') as HTMLInputElement
            valueInput.focus()

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

            const focused = document.activeElement as HTMLInputElement
            expect(focused.closest('td')?.getAttribute('data-col')).to.equal('Value')
        })

        test('ArrowLeft on the first column is a no-op', () => {
            const nameInput = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
            nameInput.focus()

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))

            const focused = document.activeElement as HTMLInputElement
            expect(focused.closest('td')?.getAttribute('data-col')).to.equal('Name')
        })

        test('Arrow keys while editing do not move focus', () => {
            const valueInput = document.querySelector('tr[data-var="alpha"] .wsb-value-input') as HTMLInputElement
            valueInput.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            valueInput.focus()
            expect(valueInput.readOnly).to.be.false

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))

            const state = getState()
            expect(state.selectedVarName).to.equal('alpha')
            expect(document.activeElement).to.equal(valueInput)
        })
    })

    // ── Enter key (edit focused cell) ───────────────────────────────
    // Enter activates edit mode on whichever editable cell (Name or Value)
    // is currently focused. Non-editable cells (Class, Size) are ignored.
    // Blocked during active editing via the noInputEditing guard.

    suite('Enter key (edit focused cell)', () => {
        setup(() => {
            init(mockApi)
            populateTable()
            postedMessages = []
        })

        test('Enter on a focused readonly Name input enters edit mode', () => {
            const nameInput = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
            nameInput.focus()

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

            expect(nameInput.readOnly).to.be.false
        })

        test('Enter on a focused readonly Value input enters edit mode', () => {
            const valueInput = document.querySelector('tr[data-var="alpha"] .wsb-value-input') as HTMLInputElement
            valueInput.focus()

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

            expect(valueInput.readOnly).to.be.false
        })

        test('Enter on a focused Class/Size input is a no-op', () => {
            const textInput = document.querySelector('tr[data-var="alpha"] .wsb-text-input') as HTMLInputElement
            textInput.focus()

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

            expect(textInput.readOnly).to.be.true
        })

        test('Enter with no focus is a no-op', () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

            const inputs = document.querySelectorAll<HTMLInputElement>('.wsb-value-input, .wsb-name-input')
            for (const input of inputs) {
                expect(input.readOnly).to.be.true
            }
        })

        test('Enter while editing does not bubble to re-enter edit mode', () => {
            const valueInput = document.querySelector('tr[data-var="alpha"] .wsb-value-input') as HTMLInputElement
            valueInput.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            valueInput.focus()
            expect(valueInput.readOnly).to.be.false

            // Simulate the input's own keydown handler dispatching Enter with stopPropagation
            const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
            valueInput.dispatchEvent(event)

            // After the input handler blurs, the input should be readonly and NOT re-enter edit mode
            expect(valueInput.readOnly).to.be.true
        })
    })

    // ── F2 key (rename) ─────────────────────────────────────────────
    // F2 always enters edit mode on the Name input of the selected row,
    // regardless of which cell is focused. Blocked during active editing.

    suite('F2 key (rename)', () => {
        setup(() => {
            init(mockApi)
            populateTable()
            postedMessages = []
        })

        test('F2 with a selected row enters edit mode on the name input', () => {
            const nameInput = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
            nameInput.focus()

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))

            expect(nameInput.readOnly).to.be.false
        })

        test('F2 with no selected row is a no-op', () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))

            const inputs = document.querySelectorAll<HTMLInputElement>('.wsb-name-input')
            for (const input of inputs) {
                expect(input.readOnly).to.be.true
            }
        })

        test('F2 while editing a value input does not trigger rename', () => {
            const valueInput = document.querySelector('tr[data-var="alpha"] .wsb-value-input') as HTMLInputElement
            valueInput.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            valueInput.focus()

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))

            const nameInput = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
            expect(nameInput.readOnly).to.be.true
        })

        test('F2 while editing a name input does not re-trigger edit mode', () => {
            const nameInput = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
            nameInput.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            nameInput.focus()

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))

            // Guard blocks; input remains in edit mode
            expect(nameInput.readOnly).to.be.false
        })
    })
})
