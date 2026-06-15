// Copyright 2026 The MathWorks, Inc.

// Tests for webview message handling in WorkspaceBrowserProvider.
// Verifies that 'ready', 'editValue', 'renameVariable', 'deleteVariable',
// and 'stateChanged' messages from the webview trigger the correct actions.

import { expect } from 'chai'
import * as sinon from 'sinon'
import * as vscode from 'vscode'
import { createProviderTestHarness } from './helpers'

suite('WorkspaceBrowserProvider — webview messages', () => {
    teardown(() => {
        sinon.restore()
    })

    // ── ready ────────────────────────────────────────────────────
    // The webview posts 'ready' after init() completes. The provider must replay
    // any cached columns, data, and state so the table renders immediately.
    // Without this, reopening the sidebar panel (which destroys and recreates
    // the webview) would show an empty table until the next DataChanged event.

    suite('ready message', () => {
        test('sends cached columns and data back to webview', () => {
            const { serverHandler, webviewHandler, postMessage } = createProviderTestHarness({ captureWebviewHandler: true })

            // Populate cache by simulating server messages
            serverHandler({
                type: 'Columns',
                columns: [{ name: 'Name', label: 'Name' }]
            })
            serverHandler({
                type: 'Data',
                data: [{ Name: 'x', Class: 'double', Size: '1x1', Value: '1' }]
            })
            postMessage.resetHistory()

            // Webview signals ready — provider should replay cached data
            webviewHandler({ type: 'ready' })

            const setColumnsMsg = postMessage.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0]?.type === 'setColumns'
            )
            const setDataMsg = postMessage.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0]?.type === 'setData'
            )
            expect(setColumnsMsg).to.not.be.undefined
            expect(setDataMsg).to.not.be.undefined
        })

        test('sends default columns when no cached columns exist', () => {
            const { webviewHandler, postMessage } = createProviderTestHarness({ captureWebviewHandler: true })
            postMessage.resetHistory()

            // Ready without any prior server messages — no cached columns
            webviewHandler({ type: 'ready' })

            const setColumnsMsg = postMessage.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0]?.type === 'setColumns'
            )
            expect(setColumnsMsg).to.not.be.undefined
            const cols = setColumnsMsg?.args[0]?.columns
            expect(cols).to.have.length(4)
            expect(cols[0].name).to.equal('Name')
            expect(cols[1].name).to.equal('Value')
            expect(cols[2].name).to.equal('Size')
            expect(cols[3].name).to.equal('Class')
        })
    })

    // ── editValue ────────────────────────────────────────────────
    // editValue is the bridge between the webview input field and MATLAB variable
    // assignment. It uses evalin with the active workspace ('base' normally,
    // 'caller' during debug) so edits target the displayed scope. Errors must be
    // sent back as operationError so the webview can revert the input and show
    // feedback. The readiness guard ensures we don't queue operations when MATLAB
    // is busy.

    suite('editValue message', () => {
        test('calls mvm.feval with evalin to assign the new value', async () => {
            const { webviewHandler, mvm } = createProviderTestHarness({ captureWebviewHandler: true })

            webviewHandler({ type: 'editValue', variable: 'x', newValue: '42' })
            // Allow promise chain to resolve
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(mvm.feval.calledOnce).to.be.true
            expect(mvm.feval.firstCall.args[0]).to.equal('evalin')
            expect(mvm.feval.firstCall.args[2]).to.deep.include('x = 42;')
        })

        test('posts operationError and shows toast when feval throws', async () => {
            const { webviewHandler, mvm, postMessage } = createProviderTestHarness({ captureWebviewHandler: true })
            mvm.feval.rejects(new Error('Invalid expression'))
            const showError = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined)

            webviewHandler({ type: 'editValue', variable: 'x', newValue: 'bad' })
            await new Promise(resolve => setTimeout(resolve, 0))

            const errorMsg = postMessage.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0]?.type === 'operationError'
            )
            expect(errorMsg).to.not.be.undefined
            expect(errorMsg?.args[0]?.operation).to.equal('editValue')
            expect(errorMsg?.args[0]?.variable).to.equal('x')
            expect(showError.calledOnce).to.be.true
            expect(showError.firstCall.args[0]).to.include('Edit failed')
            expect(showError.firstCall.args[0]).to.include('Invalid expression')
        })

        test('shows toast notification when feval returns error', async () => {
            const { webviewHandler, mvm } = createProviderTestHarness({ captureWebviewHandler: true })
            mvm.feval.resolves({ error: { id: 'MATLAB:error', msg: 'Undefined function or variable', status: 'error' } })
            const showError = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined)

            webviewHandler({ type: 'editValue', variable: 'x', newValue: '[1 2 3' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(showError.calledOnce).to.be.true
            expect(showError.firstCall.args[0]).to.include('Edit failed')
            expect(showError.firstCall.args[0]).to.include('Undefined function or variable')
        })

        test('returns silently when MATLAB is not ready', async () => {
            const { webviewHandler, mvm } = createProviderTestHarness({ captureWebviewHandler: true })
            mvm.getReadyPromise.rejects(new Error('not ready'))

            // Should not throw or call feval
            webviewHandler({ type: 'editValue', variable: 'x', newValue: '1' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(mvm.feval.called).to.be.false
        })
    })

    // ── renameVariable ─────────────────────────────────────────────
    // renameVariable copies the variable to the new name and clears the old one.
    // It checks for duplicate names in the cached workspace state before issuing
    // the feval. Name validation is handled by MATLAB which returns descriptive errors.

    suite('renameVariable message', () => {
        test('calls mvm.feval with evalin to rename the variable', async () => {
            const { webviewHandler, mvm } = createProviderTestHarness({ captureWebviewHandler: true })

            webviewHandler({ type: 'renameVariable', variable: 'x', newName: 'y' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(mvm.feval.calledOnce).to.be.true
            expect(mvm.feval.firstCall.args[0]).to.equal('evalin')
            expect(mvm.feval.firstCall.args[2]).to.deep.include("y = x; clear('x');")
        })

        test('posts operationError and shows toast when renamed to invalid name', async () => {
            const { webviewHandler, mvm, postMessage } = createProviderTestHarness({ captureWebviewHandler: true })
            const showError = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined)

            webviewHandler({ type: 'renameVariable', variable: 'x', newName: '123bad' })
            await new Promise(resolve => setTimeout(resolve, 0))

            // Rejected client-side — feval is never called
            expect(mvm.feval.called).to.be.false
            expect(showError.calledOnce).to.be.true
            expect(showError.firstCall.args[0]).to.include('Rename failed')

            const errorMsg = postMessage.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0]?.type === 'operationError'
            )
            expect(errorMsg).to.not.be.undefined
            expect(errorMsg?.args[0]?.variable).to.equal('x')
        })

        test('posts operationError and shows toast when new name already exists in cached rows', async () => {
            const { serverHandler, webviewHandler, mvm, postMessage } = createProviderTestHarness({ captureWebviewHandler: true })
            const showError = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined)

            // Populate cached rows
            serverHandler({
                type: 'Columns',
                columns: [{ name: 'Name', label: 'Name' }, { name: 'Value', label: 'Value' }, { name: 'Size', label: 'Size' }, { name: 'Class', label: 'Class' }]
            })
            serverHandler({
                type: 'Data',
                data: [{ Name: 'x', Class: 'double', Size: '1x1', Value: '1' }, { Name: 'y', Class: 'double', Size: '1x1', Value: '2' }]
            })
            postMessage.resetHistory()

            webviewHandler({ type: 'renameVariable', variable: 'x', newName: 'y' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(mvm.feval.called).to.be.false
            const errorMsg = postMessage.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0]?.type === 'operationError'
            )
            expect(errorMsg).to.not.be.undefined
            expect(errorMsg?.args[0]?.message).to.include('already exists')
            expect(showError.calledOnce).to.be.true
            expect(showError.firstCall.args[0]).to.include('Rename failed')
            expect(showError.firstCall.args[0]).to.include('already exists')
        })

        test('posts operationError and shows toast when feval throws', async () => {
            const { webviewHandler, mvm, postMessage } = createProviderTestHarness({ captureWebviewHandler: true })
            mvm.feval.rejects(new Error('MATLAB error'))
            const showError = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined)
            postMessage.resetHistory()

            webviewHandler({ type: 'renameVariable', variable: 'x', newName: 'z' })
            await new Promise(resolve => setTimeout(resolve, 0))

            const errorMsg = postMessage.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0]?.type === 'operationError'
            )
            expect(errorMsg).to.not.be.undefined
            expect(errorMsg?.args[0]?.operation).to.equal('rename')
            expect(showError.calledOnce).to.be.true
            expect(showError.firstCall.args[0]).to.include('Rename failed')
            expect(showError.firstCall.args[0]).to.include('MATLAB error')
        })
    })

    // ── deleteVariable ──────────────────────────────────────────────
    // deleteVariable shows a confirmation dialog before clearing. If the user
    // cancels, no action is taken. If confirmed, evalin clears the variable
    // from the active workspace ('base' or 'caller' during debug).

    suite('deleteVariable message', () => {
        test('calls mvm.feval with clear when user confirms', async () => {
            const { webviewHandler, mvm } = createProviderTestHarness({ captureWebviewHandler: true })
            sinon.stub(vscode.window, 'showWarningMessage').resolves('Delete' as any)

            webviewHandler({ type: 'deleteVariable', variable: 'x' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(mvm.feval.calledOnce).to.be.true
            expect(mvm.feval.firstCall.args[0]).to.equal('evalin')
            expect(mvm.feval.firstCall.args[2]).to.deep.include("clear('x');")
        })

        test('does not call feval when user cancels', async () => {
            const { webviewHandler, mvm } = createProviderTestHarness({ captureWebviewHandler: true })
            sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined)

            webviewHandler({ type: 'deleteVariable', variable: 'x' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(mvm.feval.called).to.be.false
        })

        test('posts operationError and shows toast when feval throws', async () => {
            const { webviewHandler, mvm, postMessage } = createProviderTestHarness({ captureWebviewHandler: true })
            sinon.stub(vscode.window, 'showWarningMessage').resolves('Delete' as any)
            mvm.feval.rejects(new Error('MATLAB error'))
            const showError = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined)
            postMessage.resetHistory()

            webviewHandler({ type: 'deleteVariable', variable: 'x' })
            await new Promise(resolve => setTimeout(resolve, 0))

            const errorMsg = postMessage.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0]?.type === 'operationError'
            )
            expect(errorMsg).to.not.be.undefined
            expect(errorMsg?.args[0]?.operation).to.equal('delete')
            expect(showError.calledOnce).to.be.true
            expect(showError.firstCall.args[0]).to.include('Delete failed')
            expect(showError.firstCall.args[0]).to.include('MATLAB error')
        })

        test('shows toast notification when feval returns error', async () => {
            const { webviewHandler, mvm } = createProviderTestHarness({ captureWebviewHandler: true })
            sinon.stub(vscode.window, 'showWarningMessage').resolves('Delete' as any)
            mvm.feval.resolves({ error: { id: 'MATLAB:err', msg: 'Cannot clear protected variable', status: 'error' } })
            const showError = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined)

            webviewHandler({ type: 'deleteVariable', variable: 'x' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(showError.calledOnce).to.be.true
            expect(showError.firstCall.args[0]).to.include('Delete failed')
            expect(showError.firstCall.args[0]).to.include('Cannot clear protected variable')
        })
    })

    // ── stateChanged ─────────────────────────────────────────────
    // The webview posts stateChanged whenever sort order or column widths change.
    // The provider persists this to workspaceState so it survives VS Code reload
    // and webview disposal. The key 'wsb-state' must match what the constructor
    // reads on startup, otherwise state would be written but never restored.

    suite('stateChanged message', () => {
        test('persists state to workspaceState', () => {
            const { webviewHandler, context } = createProviderTestHarness({ captureWebviewHandler: true })
            const state = { sortColumn: 'Name', sortDirection: 'asc' as const }

            webviewHandler({ type: 'stateChanged', state })

            expect(context.workspaceState.update.calledOnce).to.be.true
            expect(context.workspaceState.update.firstCall.args[0]).to.equal('wsb-state')
            expect(context.workspaceState.update.firstCall.args[1]).to.deep.equal(state)
        })
    })
})
