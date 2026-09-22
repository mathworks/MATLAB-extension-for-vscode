// Copyright 2026 The MathWorks, Inc.

// Tests for VariableViewerPanelManager: verifies panel creation, reuse,
// disposal, server response routing, type transitions, and MATLAB lifecycle.

import { expect } from 'chai'
import * as sinon from 'sinon'
import { createPanelManagerHarness, disposeAllHarnesses } from './helpers'

// ── Tests ────────────────────────────────────────────────────────

suite('VariableViewerPanelManager', () => {
    teardown(() => {
        disposeAllHarnesses()
        sinon.restore()
    })

    // Verifies that opening a variable creates a new WebviewPanel tab
    test('openVariable creates a new panel when none exists for that variable', () => {
        // Setup
        const { manager, createdPanels } = createPanelManagerHarness()

        // Exercise
        manager.openVariable('myMatrix')

        // Verify
        expect(createdPanels).to.have.lengthOf(1)
        expect(createdPanels[0].title).to.equal('myMatrix')
    })

    // Verifies duplicate prevention — second open reveals existing tab
    test('openVariable reveals existing panel instead of creating a duplicate', () => {
        // Setup
        const { manager, createdPanels, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('myMatrix')
        const panel = getLastPanel()

        // Exercise
        manager.openVariable('myMatrix')

        // Verify
        expect(createdPanels).to.have.lengthOf(1)
        expect(panel.reveal.calledOnce).to.equal(true)
    })

    // Verifies that opening a variable sends QueryVariable request
    test('openVariable sends QueryVariable request to server', () => {
        // Setup
        const { manager, sendRequest } = createPanelManagerHarness()

        // Exercise
        manager.openVariable('data')

        // Verify
        const request = sendRequest.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'QueryVariable' && c.args[0]?.varName === 'data'
        )
        expect(request).to.not.be.undefined
    })

    // Verifies that closing a tab removes it from tracking
    test('panel disposal removes entry from the map', () => {
        // Setup
        const { manager, createdPanels, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('temp')
        const panel = getLastPanel()
        const disposeCallback = panel.onDidDispose.firstCall.args[0]

        // Exercise
        disposeCallback()
        manager.openVariable('temp')

        // Verify
        expect(createdPanels).to.have.lengthOf(2)
    })

    // Verifies that VariableResponse updates the panel title to the variable name
    test('VariableResponse updates panel title to variable name', () => {
        // Setup
        const { manager, serviceListener, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('A')
        const panel = getLastPanel()

        // Exercise
        serviceListener({
            type: 'VariableResponse',
            varName: 'A',
            metadata: { dataType: 'double', size: [10, 20], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })
        const result = panel.title

        // Verify
        expect(result).to.equal('A')
    })

    // Verifies that VariableDeleted shows deletion message
    test('VariableDeleted response shows deletion message in panel', () => {
        // Setup
        const { manager, serviceListener, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('gone')
        const panel = getLastPanel()

        // Exercise
        serviceListener({ type: 'VariableDeleted', varName: 'gone' })
        const result = panel.webview.html

        // Verify
        expect(result).to.include('gone')
    })

    // Verifies that MATLAB disconnection disposes all panels
    test('MATLAB disconnect disposes all open panels', () => {
        // Setup
        const { manager, stateChangedCallback, createdPanels } = createPanelManagerHarness()
        manager.openVariable('x')
        manager.openVariable('y')

        // Exercise
        stateChangedCallback('connected', 'disconnected')

        // Verify
        for (const panel of createdPanels) {
            expect(panel.dispose.calledOnce).to.equal(true)
        }
    })

    // Verifies that opening while disconnected is a no-op
    test('openVariable while disconnected does not create a panel', () => {
        // Setup
        const { manager, mvm, createdPanels } = createPanelManagerHarness()
        mvm.getMatlabState.returns('disconnected')

        // Exercise
        manager.openVariable('z')

        // Verify
        expect(createdPanels).to.have.lengthOf(0)
    })

    // Verifies that VariableResponse with preview posts to webview
    test('VariableResponse with preview posts variableResponse with preview to webview', () => {
        // Setup
        const { manager, serviceListener, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('s')
        const panel = getLastPanel()

        // Exercise
        serviceListener({
            type: 'VariableResponse',
            varName: 's',
            metadata: { dataType: 'struct', size: [1, 1], isSparse: false, isTall: false },
            preview: 'Name: [1x1 string]'
        })
        const msg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'variableResponse' && c.args[0]?.preview != null
        )

        // Verify
        expect(msg).to.not.be.undefined
        expect(msg!.args[0].preview).to.equal('Name: [1x1 string]')
    })

    // Verifies that VariableResponse with cells posts to webview without preview
    test('VariableResponse for supported type posts cells to webview without preview', () => {
        // Setup
        const { manager, serviceListener, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('nums')
        const panel = getLastPanel()

        // Exercise
        serviceListener({
            type: 'VariableResponse',
            varName: 'nums',
            metadata: { dataType: 'double', size: [5, 5], isSparse: false, isTall: false },
            cells: { data: [['1', '2'], ['3', '4']], startRow: 1, startCol: 1 }
        })
        const msg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'variableResponse' && c.args[0]?.cells != null
        )

        // Verify
        expect(msg).to.not.be.undefined
        expect(msg!.args[0].cells.data[0][0]).to.equal('1')
        expect(msg!.args[0].preview).to.be.undefined
    })

    // Verifies that 1-based server indices are converted to 0-based for the webview
    test('VariableResponse converts 1-based cell indices to 0-based for webview', () => {
        // Setup
        const { manager, serviceListener, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('paged')
        const panel = getLastPanel()

        // Exercise
        serviceListener({
            type: 'VariableResponse',
            varName: 'paged',
            metadata: { dataType: 'double', size: [100, 100], isSparse: false, isTall: false },
            cells: { data: [['42']], startRow: 51, startCol: 21 }
        })
        const msg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'variableResponse' && c.args[0]?.cells != null
        )

        // Verify
        expect(msg).to.not.be.undefined
        expect(msg!.args[0].cells.startRow).to.equal(50)
        expect(msg!.args[0].cells.startCol).to.equal(20)
    })

    // Verifies that webview ready re-sends cached state for unsupported types
    test('webview ready re-sends cached variableResponse for unsupported type', () => {
        // Setup
        const { manager, serviceListener, getLastPanel, getWebviewHandler } = createPanelManagerHarness()
        manager.openVariable('cached')
        const panel = getLastPanel()
        serviceListener({
            type: 'VariableResponse',
            varName: 'cached',
            metadata: { dataType: 'struct', size: [1, 1], isSparse: false, isTall: false },
            preview: '[1x1 struct]'
        })
        panel.webview.postMessage.resetHistory()
        const handler = getWebviewHandler(panel)

        // Exercise
        handler({ type: 'ready' })
        const msg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'variableResponse'
        )

        // Verify
        expect(msg).to.not.be.undefined
        expect(msg!.args[0].metadata.dataType).to.equal('struct')
    })

    // Verifies that webview ready re-queries server for grid-type variables
    test('webview ready re-queries server for grid type', () => {
        // Setup
        const { manager, serviceListener, getLastPanel, getWebviewHandler, sendRequest } = createPanelManagerHarness()
        manager.openVariable('cached')
        const panel = getLastPanel()
        serviceListener({
            type: 'VariableResponse',
            varName: 'cached',
            metadata: { dataType: 'int32', size: [2, 3], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })
        sendRequest.resetHistory()
        const handler = getWebviewHandler(panel)

        // Exercise
        handler({ type: 'ready' })

        // Verify
        expect(sendRequest.calledWith({ type: 'QueryVariable', varName: 'cached' })).to.be.true
    })

    // Verifies that webview ready with no cache sends QueryVariable
    test('webview ready with no cache sends QueryVariable', () => {
        // Setup
        const { manager, getLastPanel, getWebviewHandler, sendRequest } = createPanelManagerHarness()
        manager.openVariable('fresh')
        const panel = getLastPanel()
        sendRequest.resetHistory()
        const handler = getWebviewHandler(panel)

        // Exercise
        handler({ type: 'ready' })

        // Verify
        const request = sendRequest.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'QueryVariable' && c.args[0]?.varName === 'fresh'
        )
        expect(request).to.not.be.undefined
    })

    // Verifies that requestPage message is forwarded as QueryPage
    test('requestPage webview message sends QueryPage to server', () => {
        // Setup
        const { manager, getLastPanel, getWebviewHandler, sendRequest } = createPanelManagerHarness()
        manager.openVariable('big')
        const panel = getLastPanel()
        sendRequest.resetHistory()
        const handler = getWebviewHandler(panel)

        // Exercise
        handler({ type: 'requestPage', varName: 'big', startRow: 50, startCol: 0 })

        // Verify
        const request = sendRequest.getCalls().find(
            (c: sinon.SinonSpyCall) =>
                c.args[0]?.type === 'QueryPage' &&
                c.args[0]?.startRow === 51 &&
                c.args[0]?.startCol === 1
        )
        expect(request).to.not.be.undefined
    })

    // Verifies that workspace refresh with missing variable triggers deletion flow
    test('onWorkspaceRefreshed triggers deletion when variable is absent', () => {
        // Setup
        const { manager, serviceListener, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('gone')
        const panel = getLastPanel()
        serviceListener({
            type: 'VariableResponse',
            varName: 'gone',
            metadata: { dataType: 'double', size: [3, 3], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })
        panel.webview.postMessage.resetHistory()

        // Exercise
        manager.onWorkspaceRefreshed([
            { name: 'other', className: 'double', size: '5x5' }
        ])
        const deletedMsg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'variableDeleted'
        )

        // Verify
        expect(deletedMsg).to.not.be.undefined
        expect(deletedMsg!.args[0].varName).to.equal('gone')
        expect(panel.webview.html).to.include('gone')
    })

    // Verifies that workspace refresh with changed class re-queries
    test('onWorkspaceRefreshed re-queries when class changes', () => {
        // Setup
        const { manager, serviceListener, sendRequest } = createPanelManagerHarness()
        manager.openVariable('data')
        serviceListener({
            type: 'VariableResponse',
            varName: 'data',
            metadata: { dataType: 'double', size: [3, 3], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })
        sendRequest.resetHistory()

        // Exercise
        manager.onWorkspaceRefreshed([
            { name: 'data', className: 'single', size: '3x3' }
        ])

        // Verify
        const request = sendRequest.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'QueryVariable' && c.args[0]?.varName === 'data'
        )
        expect(request).to.not.be.undefined
    })

    // Verifies that workspace refresh with same class/size posts dataStale
    test('onWorkspaceRefreshed posts dataStale when class and size unchanged', () => {
        // Setup
        const { manager, serviceListener, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('stable')
        const panel = getLastPanel()
        serviceListener({
            type: 'VariableResponse',
            varName: 'stable',
            metadata: { dataType: 'double', size: [4, 5], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })
        panel.webview.postMessage.resetHistory()

        // Exercise
        manager.onWorkspaceRefreshed([
            { name: 'stable', className: 'double', size: '4x5' }
        ])
        const staleMsg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'dataStale'
        )

        // Verify
        expect(staleMsg).to.not.be.undefined
    })

    // Verifies that VariableChanged push event triggers a re-query
    test('VariableChanged push event triggers QueryVariable re-query', () => {
        // Setup
        const { manager, serviceListener, sendRequest } = createPanelManagerHarness()
        manager.openVariable('v')
        sendRequest.resetHistory()

        // Exercise
        serviceListener({
            type: 'VariableChanged',
            varName: 'v',
            className: 'double',
            size: [10, 10]
        })

        // Verify
        const request = sendRequest.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'QueryVariable' && c.args[0]?.varName === 'v'
        )
        expect(request).to.not.be.undefined
    })

    // Verifies that MATLAB idle transition posts dataStale to visible supported panels
    test('MATLAB idle transition posts dataStale to visible supported panel', () => {
        // Setup
        const { manager, serviceListener, getLastPanel, promptChangeCallback } = createPanelManagerHarness()
        manager.openVariable('a')
        const panel = getLastPanel()
        serviceListener({
            type: 'VariableResponse',
            varName: 'a',
            metadata: { dataType: 'double', size: [4, 1], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })
        panel.webview.postMessage.resetHistory()

        // Exercise
        promptChangeCallback('', true)
        const staleMsg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'dataStale'
        )

        // Verify
        expect(staleMsg).to.not.be.undefined
    })

    // Verifies that MATLAB idle transition re-queries unsupported panels
    test('MATLAB idle transition re-queries unsupported panel', () => {
        // Setup
        const { manager, serviceListener, sendRequest, promptChangeCallback } = createPanelManagerHarness()
        manager.openVariable('s')
        serviceListener({
            type: 'VariableResponse',
            varName: 's',
            metadata: { dataType: 'struct', size: [1, 1], isSparse: false, isTall: false },
            preview: 'struct preview'
        })
        sendRequest.resetHistory()

        // Exercise
        promptChangeCallback('', true)

        // Verify
        const request = sendRequest.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'QueryVariable' && c.args[0]?.varName === 's'
        )
        expect(request).to.not.be.undefined
    })

    // Verifies that MATLAB idle transition skips hidden panels
    test('MATLAB idle transition skips hidden panels', () => {
        // Setup
        const { manager, serviceListener, getLastPanel, promptChangeCallback } = createPanelManagerHarness()
        manager.openVariable('a')
        const panel = getLastPanel()
        serviceListener({
            type: 'VariableResponse',
            varName: 'a',
            metadata: { dataType: 'double', size: [4, 1], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })
        panel.visible = false
        panel.webview.postMessage.resetHistory()

        // Exercise
        promptChangeCallback('', true)
        const staleMsg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'dataStale'
        )

        // Verify
        expect(staleMsg).to.be.undefined
    })

    // Verifies that MATLAB busy transition does not invalidate
    test('MATLAB busy transition does not invalidate panels', () => {
        // Setup
        const { manager, serviceListener, getLastPanel, promptChangeCallback } = createPanelManagerHarness()
        manager.openVariable('a')
        const panel = getLastPanel()
        serviceListener({
            type: 'VariableResponse',
            varName: 'a',
            metadata: { dataType: 'double', size: [4, 1], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })
        panel.webview.postMessage.resetHistory()

        // Exercise
        promptChangeCallback('', false)
        const staleMsg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'dataStale'
        )

        // Verify
        expect(staleMsg).to.be.undefined
    })

    // Verifies that a sparse numeric array is unsupported (has preview, no cells)
    test('sparse numeric array receives preview via VariableResponse', () => {
        // Setup
        const { manager, serviceListener, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('sp')
        const panel = getLastPanel()

        // Exercise
        serviceListener({
            type: 'VariableResponse',
            varName: 'sp',
            metadata: { dataType: 'double', size: [100, 100], isSparse: true, isTall: false },
            preview: '  (1,1)  1\n  (2,2)  2'
        })
        const msg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'variableResponse' && c.args[0]?.preview != null
        )

        // Verify
        expect(msg).to.not.be.undefined
        expect(msg!.args[0].cells).to.be.undefined
    })

    // Verifies that a tall array is unsupported
    test('tall array receives preview via VariableResponse', () => {
        // Setup
        const { manager, serviceListener, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('t')
        const panel = getLastPanel()

        // Exercise
        serviceListener({
            type: 'VariableResponse',
            varName: 't',
            metadata: { dataType: 'double', size: [Infinity, 3], isSparse: false, isTall: true },
            preview: 'M tall double'
        })
        const msg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'variableResponse' && c.args[0]?.preview != null
        )

        // Verify
        expect(msg).to.not.be.undefined
        expect(msg!.args[0].cells).to.be.undefined
    })

    // Verifies that an N-D array is unsupported
    test('N-dimensional array receives preview via VariableResponse', () => {
        // Setup
        const { manager, serviceListener, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('nd')
        const panel = getLastPanel()

        // Exercise
        serviceListener({
            type: 'VariableResponse',
            varName: 'nd',
            metadata: { dataType: 'double', size: [3, 4, 5], isSparse: false, isTall: false },
            preview: 'val(:,:,1) = ...'
        })
        const msg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'variableResponse' && c.args[0]?.preview != null
        )

        // Verify
        expect(msg).to.not.be.undefined
        expect(msg!.args[0].cells).to.be.undefined
    })

    // Verifies that a 2-D numeric array is supported (has cells, no preview)
    test('2-D numeric array receives cells via VariableResponse', () => {
        // Setup
        const { manager, serviceListener, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('m')
        const panel = getLastPanel()

        // Exercise
        serviceListener({
            type: 'VariableResponse',
            varName: 'm',
            metadata: { dataType: 'double', size: [5, 5], isSparse: false, isTall: false },
            cells: { data: [['1', '2'], ['3', '4']], startRow: 1, startCol: 1 }
        })
        const msg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'variableResponse' && c.args[0]?.cells != null
        )

        // Verify
        expect(msg).to.not.be.undefined
        expect(msg!.args[0].preview).to.be.undefined
    })

    // Verifies that openVariable with an old MATLAB release is a no-op
    test('openVariable with old MATLAB release does not create a panel', () => {
        // Setup
        const { manager, mvm, createdPanels } = createPanelManagerHarness()
        mvm.getMatlabRelease.returns('R2022b')

        // Exercise
        manager.openVariable('x')

        // Verify
        expect(createdPanels).to.have.lengthOf(0)
    })

    // Verifies that openVariable with null MATLAB release is a no-op
    test('openVariable with null MATLAB release does not create a panel', () => {
        // Setup
        const { manager, mvm, createdPanels } = createPanelManagerHarness()
        mvm.getMatlabRelease.returns(null)

        // Exercise
        manager.openVariable('x')

        // Verify
        expect(createdPanels).to.have.lengthOf(0)
    })

    // Verifies that server Error with "not found" triggers deletion flow
    test('Error response with not-found message triggers deletion flow', () => {
        // Setup
        const { manager, serviceListener, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('missing')
        const panel = getLastPanel()

        // Exercise
        serviceListener({
            type: 'Error',
            varName: 'missing',
            requestType: 'QueryVariable',
            message: 'Undefined function or variable not found'
        })
        const deletedMsg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'variableDeleted'
        )

        // Verify
        expect(deletedMsg).to.not.be.undefined
        expect(deletedMsg!.args[0].varName).to.equal('missing')
        expect(panel.webview.html).to.include('missing')
    })

    // Verifies that server Error response with "timeout" translates to timeout message
    test('Error response with timeout message translates to timed out', () => {
        // Setup
        const { manager, serviceListener, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('slow')
        const panel = getLastPanel()

        // Exercise
        serviceListener({
            type: 'Error',
            varName: 'slow',
            requestType: 'QueryVariable',
            message: 'Request timed out after 30s'
        })
        const errorMsg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'error'
        )

        // Verify
        expect(errorMsg).to.not.be.undefined
        expect(errorMsg!.args[0].message).to.include('timed out')
    })

    // Verifies that server Error response with unknown message translates to generic error
    test('Error response with unknown message translates to generic unable to retrieve', () => {
        // Setup
        const { manager, serviceListener, getLastPanel } = createPanelManagerHarness()
        manager.openVariable('broken')
        const panel = getLastPanel()

        // Exercise
        serviceListener({
            type: 'Error',
            varName: 'broken',
            requestType: 'QueryVariable',
            message: 'Internal engine failure XYZ'
        })
        const errorMsg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'error'
        )

        // Verify
        expect(errorMsg).to.not.be.undefined
        expect(errorMsg!.args[0].message).to.include('Unable to retrieve')
    })

    // Verifies that idle transition skips panels with no cached variable state
    test('MATLAB idle transition skips panels with no cached state', () => {
        // Setup
        const { manager, getLastPanel, promptChangeCallback } = createPanelManagerHarness()
        manager.openVariable('fresh')
        const panel = getLastPanel()
        panel.webview.postMessage.resetHistory()

        // Exercise
        promptChangeCallback('', true)
        const staleMsg = panel.webview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'dataStale'
        )

        // Verify
        expect(staleMsg).to.be.undefined
    })
})
