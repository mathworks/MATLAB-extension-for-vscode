// Copyright 2026 The MathWorks, Inc.

// Tests for all WSB telemetry events: panel open/close, edit, rename, delete,
// truncation shown, and change-limit clicked.

import { expect } from 'chai'
import * as sinon from 'sinon'
import * as vscode from 'vscode'
import { createProviderTestHarness } from './helpers'

suite('WorkspaceBrowserProvider — telemetry', () => {
    teardown(() => {
        sinon.restore()
    })

    // ── Panel Open/Close ────────────────────────────────────────────

    suite('wsbPanelOpened / wsbPanelClosed', () => {
        test('logs wsbPanelOpened on resolveWebviewView', () => {
            const { telemetryLogger } = createProviderTestHarness()

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbPanelOpened', result: '' }
            })).to.be.true
        })

        test('logs wsbPanelClosed on dispose', () => {
            const { webviewView, telemetryLogger } = createProviderTestHarness()
            telemetryLogger.logEvent.resetHistory()

            const disposeCallback = webviewView.onDidDispose.firstCall.args[0]
            disposeCallback()

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbPanelClosed', result: '' }
            })).to.be.true
        })
    })

    // ── wsbEditValue ────────────────────────────────────────────────

    suite('wsbEditValue', () => {
        test('logs success when eval completes without error', async () => {
            const { webviewHandler, telemetryLogger } = createProviderTestHarness({ captureWebviewHandler: true })
            telemetryLogger.logEvent.resetHistory()

            webviewHandler({ type: 'editValue', variable: 'x', newValue: '42' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbEditValue', result: 'success' }
            })).to.be.true
        })

        test('logs notReady when MATLAB is not connected', async () => {
            const { webviewHandler, mvm, telemetryLogger } = createProviderTestHarness({ captureWebviewHandler: true })
            mvm.getReadyPromise.rejects(new Error('not ready'))
            telemetryLogger.logEvent.resetHistory()

            webviewHandler({ type: 'editValue', variable: 'x', newValue: '1' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbEditValue', result: 'notReady' }
            })).to.be.true
        })

        test('logs error when feval returns error response', async () => {
            const { webviewHandler, mvm, telemetryLogger } = createProviderTestHarness({ captureWebviewHandler: true })
            mvm.feval.resolves({ error: { id: 'MATLAB:error', msg: 'bad', status: 'error' } })
            sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined)
            telemetryLogger.logEvent.resetHistory()

            webviewHandler({ type: 'editValue', variable: 'x', newValue: 'bad' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbEditValue', result: 'error' }
            })).to.be.true
        })

        test('logs error when feval throws', async () => {
            const { webviewHandler, mvm, telemetryLogger } = createProviderTestHarness({ captureWebviewHandler: true })
            mvm.feval.rejects(new Error('connection lost'))
            sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined)
            telemetryLogger.logEvent.resetHistory()

            webviewHandler({ type: 'editValue', variable: 'x', newValue: '1' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbEditValue', result: 'error' }
            })).to.be.true
        })
    })

    // ── wsbRenameVariable ───────────────────────────────────────────

    suite('wsbRenameVariable', () => {
        test('logs success when rename completes without error', async () => {
            const { webviewHandler, telemetryLogger } = createProviderTestHarness({ captureWebviewHandler: true })
            telemetryLogger.logEvent.resetHistory()

            webviewHandler({ type: 'renameVariable', variable: 'x', newName: 'y' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbRenameVariable', result: 'success' }
            })).to.be.true
        })

        test('logs invalidName when new name is not a valid identifier', async () => {
            const { webviewHandler, telemetryLogger } = createProviderTestHarness({ captureWebviewHandler: true })
            sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined)
            telemetryLogger.logEvent.resetHistory()

            webviewHandler({ type: 'renameVariable', variable: 'x', newName: '123bad' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbRenameVariable', result: 'invalidName' }
            })).to.be.true
        })

        test('logs duplicate when new name already exists in cached rows', async () => {
            const { serverHandler, webviewHandler, telemetryLogger } = createProviderTestHarness({ captureWebviewHandler: true })
            sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined)

            // Populate cache with a variable named 'y'
            serverHandler({
                type: 'Columns',
                columns: [{ name: 'Name', label: 'Name' }, { name: 'Value', label: 'Value' }, { name: 'Size', label: 'Size' }, { name: 'Class', label: 'Class' }]
            })
            serverHandler({
                type: 'Data',
                data: [{ Name: 'x', Value: '1', Size: '1x1', Class: 'double' }, { Name: 'y', Value: '2', Size: '1x1', Class: 'double' }]
            })
            telemetryLogger.logEvent.resetHistory()

            webviewHandler({ type: 'renameVariable', variable: 'x', newName: 'y' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbRenameVariable', result: 'duplicate' }
            })).to.be.true
        })

        test('logs notReady when MATLAB is not connected', async () => {
            const { webviewHandler, mvm, telemetryLogger } = createProviderTestHarness({ captureWebviewHandler: true })
            mvm.getReadyPromise.rejects(new Error('not ready'))
            telemetryLogger.logEvent.resetHistory()

            webviewHandler({ type: 'renameVariable', variable: 'x', newName: 'y' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbRenameVariable', result: 'notReady' }
            })).to.be.true
        })

        test('logs error when feval returns error response', async () => {
            const { webviewHandler, mvm, telemetryLogger } = createProviderTestHarness({ captureWebviewHandler: true })
            mvm.feval.resolves({ error: { id: 'MATLAB:error', msg: 'bad', status: 'error' } })
            sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined)
            telemetryLogger.logEvent.resetHistory()

            webviewHandler({ type: 'renameVariable', variable: 'x', newName: 'z' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbRenameVariable', result: 'error' }
            })).to.be.true
        })
    })

    // ── wsbDeleteVariable ───────────────────────────────────────────

    suite('wsbDeleteVariable', () => {
        test('logs cancelled when user dismisses the confirmation dialog', async () => {
            const { webviewHandler, telemetryLogger } = createProviderTestHarness({ captureWebviewHandler: true })
            sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined)
            telemetryLogger.logEvent.resetHistory()

            webviewHandler({ type: 'deleteVariable', variable: 'x' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbDeleteVariable', result: 'cancelled' }
            })).to.be.true
        })

        test('logs success when delete completes without error', async () => {
            const { webviewHandler, telemetryLogger } = createProviderTestHarness({ captureWebviewHandler: true })
            sinon.stub(vscode.window, 'showWarningMessage').resolves('Delete' as any)
            telemetryLogger.logEvent.resetHistory()

            webviewHandler({ type: 'deleteVariable', variable: 'x' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbDeleteVariable', result: 'success' }
            })).to.be.true
        })

        test('logs notReady when MATLAB is not connected', async () => {
            const { webviewHandler, mvm, telemetryLogger } = createProviderTestHarness({ captureWebviewHandler: true })
            sinon.stub(vscode.window, 'showWarningMessage').resolves('Delete' as any)
            mvm.getReadyPromise.rejects(new Error('not ready'))
            telemetryLogger.logEvent.resetHistory()

            webviewHandler({ type: 'deleteVariable', variable: 'x' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbDeleteVariable', result: 'notReady' }
            })).to.be.true
        })

        test('logs error when feval returns error response', async () => {
            const { webviewHandler, mvm, telemetryLogger } = createProviderTestHarness({ captureWebviewHandler: true })
            sinon.stub(vscode.window, 'showWarningMessage').resolves('Delete' as any)
            mvm.feval.resolves({ error: { id: 'MATLAB:error', msg: 'bad', status: 'error' } })
            sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined)
            telemetryLogger.logEvent.resetHistory()

            webviewHandler({ type: 'deleteVariable', variable: 'x' })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbDeleteVariable', result: 'error' }
            })).to.be.true
        })
    })

    // ── wsbTruncationShown ──────────────────────────────────────────

    suite('wsbTruncationShown', () => {
        test('logs when workspace exceeds variable limit', () => {
            const { serverHandler, telemetryLogger } = createProviderTestHarness()
            sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined)
            telemetryLogger.logEvent.resetHistory()

            // Simulate server reporting size > default limit (500)
            serverHandler({ type: 'Size', rowCount: 600, columnCount: 4 })

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbTruncationShown', result: '' }
            })).to.be.true
        })

        test('does not re-fire on subsequent size updates', () => {
            const { serverHandler, telemetryLogger } = createProviderTestHarness()
            sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined)
            telemetryLogger.logEvent.resetHistory()

            serverHandler({ type: 'Size', rowCount: 600, columnCount: 4 })
            serverHandler({ type: 'Size', rowCount: 700, columnCount: 4 })

            const truncationCalls = telemetryLogger.logEvent.getCalls().filter(
                (c: sinon.SinonSpyCall) => c.args[0]?.data?.action_type === 'wsbTruncationShown'
            )
            expect(truncationCalls).to.have.length(1)
        })
    })

    // ── wsbChangeLimitClicked ───────────────────────────────────────

    suite('wsbChangeLimitClicked', () => {
        test('logs when user clicks change-limit via webview message', () => {
            const { webviewHandler, telemetryLogger } = createProviderTestHarness({ captureWebviewHandler: true })
            telemetryLogger.logEvent.resetHistory()

            webviewHandler({ type: 'openMaxVariablesSetting' })

            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbChangeLimitClicked', result: '' }
            })).to.be.true
        })

        test('logs when user clicks change-limit via info message toast', async () => {
            const { serverHandler, telemetryLogger } = createProviderTestHarness()
            const showInfo = sinon.stub(vscode.window, 'showInformationMessage').resolves('Change Maximum Variable Count' as any)
            telemetryLogger.logEvent.resetHistory()

            serverHandler({ type: 'Size', rowCount: 600, columnCount: 4 })
            await new Promise(resolve => setTimeout(resolve, 0))

            expect(showInfo.calledOnce).to.be.true
            expect(telemetryLogger.logEvent.calledWith({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbChangeLimitClicked', result: '' }
            })).to.be.true
        })
    })
})
