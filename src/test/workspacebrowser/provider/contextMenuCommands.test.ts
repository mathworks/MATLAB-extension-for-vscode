// Copyright 2026 The MathWorks, Inc.

// Tests for the webview-side focusNameInput/focusValueInput message handlers
// triggered by context menu commands (Rename, Edit Value).

import { expect } from 'chai'
import * as sinon from 'sinon'
import { init, handleMessage, resetState } from '../../../workspacebrowser/webview'
import { WorkspaceColumn, WorkspaceVariable, WebviewToExt } from '../../../workspacebrowser/types'

// ── Webview-side context menu focus tests ────────────────────────
// When the user right-clicks a row and selects "Rename" or "Edit Value",
// the provider posts focusNameInput or focusValueInput to the webview.
// These tests verify that handleMessage enters edit mode correctly:
// readOnly becomes false, originalValue is stashed, and the input is focused.

suite('Context menu — focusNameInput / focusValueInput webview handlers', () => {
    let postedMessages: WebviewToExt[] = []

    const mockApi = {
        postMessage: (msg: WebviewToExt) => { postedMessages.push(msg) }
    }

    const testColumns: WorkspaceColumn[] = [
        { name: 'Name', label: 'Name', sortable: true, resizable: true },
        { name: 'Class', label: 'Class', sortable: true, resizable: true },
        { name: 'Size', label: 'Size', sortable: true, resizable: true },
        { name: 'Value', label: 'Value', sortable: false, resizable: true }
    ]

    const testRows: WorkspaceVariable[] = [
        { name: 'alpha', fields: { Name: 'alpha', Class: 'double', Size: '1x1', Value: '3.14' } },
        { name: 'beta', fields: { Name: 'beta', Class: 'char', Size: '1x5', Value: "'hello'" } }
    ]

    setup(() => {
        postedMessages = []
        resetState()
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
        init(mockApi)
        handleMessage({ type: 'setColumns', columns: testColumns })
        handleMessage({ type: 'setData', rows: testRows })
        postedMessages = []
    })

    teardown(() => {
        resetState()
        document.body.innerHTML = ''
        sinon.restore()
    })

    // focusNameInput is the Rename context menu entry point — it must put the
    // name input into edit mode so the user can type a new name immediately.
    test('focusNameInput sets name input to editable with original value stashed', () => {
        handleMessage({ type: 'focusNameInput', variable: 'alpha' })

        const input = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
        expect(input.readOnly).to.be.false
        expect(input.dataset.originalValue).to.equal('alpha')
    })

    // focusValueInput is the Edit Value context menu entry point — same behavior
    // as focusNameInput but targeting the value column.
    test('focusValueInput sets value input to editable with original value stashed', () => {
        handleMessage({ type: 'focusValueInput', variable: 'alpha' })

        const input = document.querySelector('tr[data-var="alpha"] .wsb-value-input') as HTMLInputElement
        expect(input.readOnly).to.be.false
        expect(input.dataset.originalValue).to.equal('3.14')
    })

    // If the variable name doesn't match any row (e.g. stale context), the
    // handler must be a no-op rather than throwing.
    test('focusNameInput with unknown variable does not throw', () => {
        expect(() => {
            handleMessage({ type: 'focusNameInput', variable: 'nonexistent' })
        }).to.not.throw()
    })

    // After focusNameInput, committing a rename via blur should still post
    // the renameVariable message — verifies the full context menu rename flow.
    test('focusNameInput followed by blur with new name posts renameVariable', () => {
        handleMessage({ type: 'focusNameInput', variable: 'alpha' })

        const input = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
        input.value = 'delta'
        input.blur()

        const renameMsg = postedMessages.find(m => m.type === 'renameVariable')
        expect(renameMsg).to.not.be.undefined
        if (renameMsg != null && renameMsg.type === 'renameVariable') {
            expect(renameMsg.variable).to.equal('alpha')
            expect(renameMsg.newName).to.equal('delta')
        }
    })

    // After focusValueInput, committing an edit via blur should post editValue.
    test('focusValueInput followed by blur with new value posts editValue', () => {
        handleMessage({ type: 'focusValueInput', variable: 'beta' })

        const input = document.querySelector('tr[data-var="beta"] .wsb-value-input') as HTMLInputElement
        input.value = '99'
        input.blur()

        const editMsg = postedMessages.find(m => m.type === 'editValue')
        expect(editMsg).to.not.be.undefined
        if (editMsg != null && editMsg.type === 'editValue') {
            expect(editMsg.variable).to.equal('beta')
            expect(editMsg.newValue).to.equal('99')
        }
    })

    // Empty-string rename must be rejected client-side without posting a message.
    test('focusNameInput followed by clearing to empty reverts without posting', () => {
        handleMessage({ type: 'focusNameInput', variable: 'alpha' })

        const input = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
        input.value = '   '
        input.blur()

        expect(input.value).to.equal('alpha')
        const renameMsg = postedMessages.find(m => m.type === 'renameVariable')
        expect(renameMsg).to.be.undefined
    })

    // After a successful rename, the row's data-var attribute should reflect
    // the new name optimistically so subsequent context menu actions work.
    test('rename updates data-var attribute optimistically', () => {
        handleMessage({ type: 'focusNameInput', variable: 'alpha' })

        const input = document.querySelector('tr[data-var="alpha"] .wsb-name-input') as HTMLInputElement
        input.value = 'delta'
        input.blur()

        // The row should now be addressable by the new name
        const tr = document.querySelector('tr[data-var="delta"]') as HTMLTableRowElement
        expect(tr).to.not.be.null

        // The vscode-context attribute should also reflect the new name
        const context = JSON.parse(tr.getAttribute('data-vscode-context') ?? '{}')
        expect(context.varName).to.equal('delta')
    })
})
