// Copyright 2026 The MathWorks, Inc.

/**
 * Tests for Variable Viewer DDUX telemetry events: vvVariableOpened,
 * vvVariableClosed, and vvScrolled.
 */

import { expect } from 'chai'
import * as sinon from 'sinon'
import { createPanelManagerHarness, disposeAllHarnesses } from './helpers'

suite('VariableViewerPanelManager — telemetry', () => {
    teardown(() => {
        disposeAllHarnesses()
        sinon.restore()
    })

    // ── vvVariableOpened ───────────────────────────────────────────

    // Verifies that the first VariableResponse for a panel emits vvVariableOpened
    // with correct dimensions, elementId, and nameHash
    test('logs vvVariableOpened on first VariableResponse', () => {
        // Setup
        const { manager, serviceListener, telemetryLogger } = createPanelManagerHarness()
        manager.openVariable('A')
        telemetryLogger.logEvent.resetHistory()

        // Exercise
        serviceListener({
            type: 'VariableResponse',
            varName: 'A',
            metadata: { dataType: 'double', size: [10, 20], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })

        // Verify
        const call = telemetryLogger.logEvent.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.data?.action_type === 'vvVariableOpened'
        )
        expect(call).to.not.be.undefined
        const event = call!.args[0]
        expect(event.eventKey).to.equal('ML_VS_CODE_ACTIONS')
        expect(event.data.dimensions).to.equal('[10,20]')
        expect(event.data.elementId).to.equal('numeric_table')
        expect(event.data.openVariableCount).to.equal(1)
        expect(event.data.nameHash).to.be.a('string')
    })

    // Verifies that subsequent responses for the same variable do NOT
    // emit duplicate vvVariableOpened events
    test('does not log vvVariableOpened on subsequent VariableResponse', () => {
        // Setup
        const { manager, serviceListener, telemetryLogger } = createPanelManagerHarness()
        manager.openVariable('A')
        serviceListener({
            type: 'VariableResponse',
            varName: 'A',
            metadata: { dataType: 'double', size: [10, 20], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })
        telemetryLogger.logEvent.resetHistory()

        // Exercise
        serviceListener({
            type: 'VariableResponse',
            varName: 'A',
            metadata: { dataType: 'double', size: [10, 20], isSparse: false, isTall: false },
            cells: { data: [['2']], startRow: 1, startCol: 1 }
        })

        // Verify
        const openCalls = telemetryLogger.logEvent.getCalls().filter(
            (c: sinon.SinonSpyCall) => c.args[0]?.data?.action_type === 'vvVariableOpened'
        )
        expect(openCalls).to.have.length(0)
    })

    // Verifies that openVariableCount reflects the actual number of open panels
    // at the time the event is emitted
    test('vvVariableOpened openVariableCount reflects panel count', () => {
        // Setup
        const { manager, serviceListener, telemetryLogger } = createPanelManagerHarness()
        manager.openVariable('A')
        serviceListener({
            type: 'VariableResponse',
            varName: 'A',
            metadata: { dataType: 'double', size: [1, 1], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })
        manager.openVariable('B')
        telemetryLogger.logEvent.resetHistory()

        // Exercise
        serviceListener({
            type: 'VariableResponse',
            varName: 'B',
            metadata: { dataType: 'table', size: [5, 3], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })

        // Verify
        const call = telemetryLogger.logEvent.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.data?.action_type === 'vvVariableOpened'
        )
        expect(call!.args[0].data.openVariableCount).to.equal(2)
    })

    // ── vvVariableClosed ──────────────────────────────────────────

    // Verifies that disposing a panel emits vvVariableClosed with
    // correct elementId, nameHash, and default viewport dimensions
    test('logs vvVariableClosed on panel dispose', () => {
        // Setup
        const { manager, serviceListener, getLastPanel, telemetryLogger } = createPanelManagerHarness()
        manager.openVariable('A')
        const panel = getLastPanel()
        serviceListener({
            type: 'VariableResponse',
            varName: 'A',
            metadata: { dataType: 'double', size: [3, 4], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })
        telemetryLogger.logEvent.resetHistory()

        // Exercise
        const disposeCallback = panel.onDidDispose.firstCall.args[0]
        disposeCallback()

        // Verify
        const call = telemetryLogger.logEvent.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.data?.action_type === 'vvVariableClosed'
        )
        expect(call).to.not.be.undefined
        const event = call!.args[0]
        expect(event.eventKey).to.equal('ML_VS_CODE_ACTIONS')
        expect(event.data.elementId).to.equal('numeric_table')
        expect(event.data.nameHash).to.be.a('string')
        expect(event.data.viewportWidth).to.equal(0)
        expect(event.data.viewportHeight).to.equal(0)
    })

    // Verifies that viewport dimensions reported by the webview are
    // included in the vvVariableClosed event
    test('vvVariableClosed includes viewport dimensions when reported', () => {
        // Setup
        const { manager, serviceListener, getLastPanel, getWebviewHandler, telemetryLogger } = createPanelManagerHarness()
        manager.openVariable('A')
        const panel = getLastPanel()
        serviceListener({
            type: 'VariableResponse',
            varName: 'A',
            metadata: { dataType: 'double', size: [3, 4], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })
        const webviewHandler = getWebviewHandler(panel)
        webviewHandler({ type: 'reportViewportSize', width: 800, height: 600 })
        telemetryLogger.logEvent.resetHistory()

        // Exercise
        const disposeCallback = panel.onDidDispose.firstCall.args[0]
        disposeCallback()

        // Verify
        const call = telemetryLogger.logEvent.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.data?.action_type === 'vvVariableClosed'
        )
        expect(call!.args[0].data.viewportWidth).to.equal(800)
        expect(call!.args[0].data.viewportHeight).to.equal(600)
    })

    // Verifies that no close event is logged if the panel was disposed
    // before ever receiving a VariableResponse
    test('does not log vvVariableClosed if no response was received', () => {
        // Setup
        const { manager, getLastPanel, telemetryLogger } = createPanelManagerHarness()
        manager.openVariable('A')
        const panel = getLastPanel()
        telemetryLogger.logEvent.resetHistory()

        // Exercise
        const disposeCallback = panel.onDidDispose.firstCall.args[0]
        disposeCallback()

        // Verify
        const closeCalls = telemetryLogger.logEvent.getCalls().filter(
            (c: sinon.SinonSpyCall) => c.args[0]?.data?.action_type === 'vvVariableClosed'
        )
        expect(closeCalls).to.have.length(0)
    })

    // ── vvScrolled ────────────────────────────────────────────────

    // Verifies that a scrolled message from the webview emits vvScrolled
    // with the correct scrollType, elementId, and nameHash
    test('logs vvScrolled on scrolled webview message', () => {
        // Setup
        const { manager, serviceListener, getLastPanel, getWebviewHandler, telemetryLogger } = createPanelManagerHarness()
        manager.openVariable('A')
        const panel = getLastPanel()
        serviceListener({
            type: 'VariableResponse',
            varName: 'A',
            metadata: { dataType: 'double', size: [100, 20], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })
        telemetryLogger.logEvent.resetHistory()

        // Exercise
        const webviewHandler = getWebviewHandler(panel)
        webviewHandler({ type: 'scrolled', scrollType: 'vertical' })

        // Verify
        const call = telemetryLogger.logEvent.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.data?.action_type === 'vvScrolled'
        )
        expect(call).to.not.be.undefined
        const event = call!.args[0]
        expect(event.data.scrollType).to.equal('vertical')
        expect(event.data.elementId).to.equal('numeric_table')
        expect(event.data.nameHash).to.be.a('string')
    })

    // Verifies that repeated scrolls in the same direction only log once per variable
    test('does not log duplicate vvScrolled for same direction', () => {
        // Setup
        const { manager, serviceListener, getLastPanel, getWebviewHandler, telemetryLogger } = createPanelManagerHarness()
        manager.openVariable('A')
        const panel = getLastPanel()
        serviceListener({
            type: 'VariableResponse',
            varName: 'A',
            metadata: { dataType: 'double', size: [100, 20], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })
        const webviewHandler = getWebviewHandler(panel)
        webviewHandler({ type: 'scrolled', scrollType: 'vertical' })
        telemetryLogger.logEvent.resetHistory()

        // Exercise
        webviewHandler({ type: 'scrolled', scrollType: 'vertical' })

        // Verify — second vertical scroll should not produce another event
        const scrollCalls = telemetryLogger.logEvent.getCalls().filter(
            (c: sinon.SinonSpyCall) => c.args[0]?.data?.action_type === 'vvScrolled'
        )
        expect(scrollCalls).to.have.length(0)
    })

    // Verifies that horizontal and vertical are tracked independently
    test('logs vvScrolled once per direction independently', () => {
        // Setup
        const { manager, serviceListener, getLastPanel, getWebviewHandler, telemetryLogger } = createPanelManagerHarness()
        manager.openVariable('A')
        const panel = getLastPanel()
        serviceListener({
            type: 'VariableResponse',
            varName: 'A',
            metadata: { dataType: 'double', size: [100, 20], isSparse: false, isTall: false },
            cells: { data: [['1']], startRow: 1, startCol: 1 }
        })
        const webviewHandler = getWebviewHandler(panel)
        webviewHandler({ type: 'scrolled', scrollType: 'vertical' })
        telemetryLogger.logEvent.resetHistory()

        // Exercise — horizontal should still log even though vertical already did
        webviewHandler({ type: 'scrolled', scrollType: 'horizontal' })

        // Verify
        const scrollCalls = telemetryLogger.logEvent.getCalls().filter(
            (c: sinon.SinonSpyCall) => c.args[0]?.data?.action_type === 'vvScrolled'
        )
        expect(scrollCalls).to.have.length(1)
        expect(scrollCalls[0].args[0].data.scrollType).to.equal('horizontal')
    })

    // Verifies that scroll telemetry is silently skipped when no
    // cached variable state exists (panel opened but no response yet)
    test('does not log vvScrolled if no cached state', () => {
        // Setup
        const { manager, getLastPanel, getWebviewHandler, telemetryLogger } = createPanelManagerHarness()
        manager.openVariable('A')
        const panel = getLastPanel()
        telemetryLogger.logEvent.resetHistory()

        // Exercise
        const webviewHandler = getWebviewHandler(panel)
        webviewHandler({ type: 'scrolled', scrollType: 'horizontal' })

        // Verify
        const scrollCalls = telemetryLogger.logEvent.getCalls().filter(
            (c: sinon.SinonSpyCall) => c.args[0]?.data?.action_type === 'vvScrolled'
        )
        expect(scrollCalls).to.have.length(0)
    })
})
