// Copyright 2026 The MathWorks, Inc.

/**
 * Shared test factory for VariableViewerPanelManager tests.
 * Provides a configurable mock setup so each test file can focus
 * on its own concerns without duplicating boilerplate.
 * @module
 */

import * as sinon from 'sinon'
import * as vscode from 'vscode'
import VariableViewerPanelManager from '../../variableviewer/VariableViewerPanelManager'
import VariableViewerService from '../../variableviewer/VariableViewerService'
import { VVServerResponse } from '../../variableviewer/types'

// ── Mock Shapes ─────────────────────────────────────────────────

/** Stub replacement for {@link vscode.WebviewPanel}. */
export interface MockWebviewPanel {
    webview: {
        html: string
        options: Record<string, unknown>
        postMessage: sinon.SinonStub
        onDidReceiveMessage: sinon.SinonStub
        asWebviewUri: (uri: any) => { toString: () => string }
    }
    visible: boolean
    title: string
    reveal: sinon.SinonStub
    onDidDispose: sinon.SinonStub
    dispose: sinon.SinonStub
}

/** Stub replacement for the MATLAB Version Manager dependency. */
export interface MockMvm {
    getMatlabState: sinon.SinonStub
    getMatlabRelease: sinon.SinonStub
    on: sinon.SinonStub
}

/** Stub replacement for {@link TelemetryLogger}. */
export interface MockTelemetryLogger {
    logEvent: sinon.SinonStub
}

/** All handles returned by {@link createPanelManagerHarness} for driving tests. */
export interface PanelManagerTestHarness {
    manager: VariableViewerPanelManager
    service: VariableViewerService
    serviceListener: (response: VVServerResponse) => void
    sendRequest: sinon.SinonStub
    mvm: MockMvm
    telemetryLogger: MockTelemetryLogger
    stateChangedCallback: (oldState: string, newState: string) => void
    promptChangeCallback: (state: string, isIdle: boolean) => void
    createdPanels: MockWebviewPanel[]
    getLastPanel: () => MockWebviewPanel
    getWebviewHandler: (panel: MockWebviewPanel) => (msg: unknown) => void
    dispose: () => void
}

// ── Harness Lifecycle ───────────────────────────────────────────

const activeManagers: VariableViewerPanelManager[] = []

/** Disposes all managers created by {@link createPanelManagerHarness}. Call in teardown. */
export function disposeAllHarnesses (): void {
    for (const manager of activeManagers) {
        manager.dispose()
    }
    activeManagers.length = 0
}

// ── Factory Function ────────────────────────────────────────────

/**
 * Creates a fully wired {@link VariableViewerPanelManager} with stubbed
 * dependencies and returns all the handles needed to drive tests.
 * @returns A harness containing the manager, stubs, and helper accessors.
 */
export function createPanelManagerHarness (): PanelManagerTestHarness {
    let serviceListener: ((response: VVServerResponse) => void) | undefined
    let stateChangedCallback: ((oldState: string, newState: string) => void) | undefined
    let promptChangeCallback: ((state: string, isIdle: boolean) => void) | undefined

    const sendRequest = sinon.stub()
    const onNotification = sinon.stub().returns({ dispose () {} })
    const notifier = { sendNotification: sendRequest, onNotification }
    const service = new VariableViewerService(notifier as any)

    const originalSetResponseListener = service.setResponseListener.bind(service)
    sinon.stub(service, 'setResponseListener').callsFake((listener) => {
        serviceListener = listener
        originalSetResponseListener(listener)
    })

    sinon.stub(service, 'sendRequest').callsFake(sendRequest)

    const mvm: MockMvm = {
        getMatlabState: sinon.stub().returns('connected'),
        getMatlabRelease: sinon.stub().returns('R2024a'),
        on: sinon.stub().callsFake((event: string, cb: (...args: any[]) => void) => {
            if (event === 'stateChanged') {
                stateChangedCallback = cb
            } else if (event === 'promptChange') {
                promptChangeCallback = cb
            }
            return { dispose () {} }
        })
    }

    const context = {
        extensionUri: { toString: () => 'test://ext' },
        workspaceState: { get: sinon.stub().returns(undefined), update: sinon.stub().resolves() },
        subscriptions: []
    }

    const createdPanels: MockWebviewPanel[] = []
    const webviewHandlers: Map<MockWebviewPanel, (msg: unknown) => void> = new Map()

    const createWebviewPanel = sinon.stub().callsFake((_viewType: string, title: string) => {
        const panel: MockWebviewPanel = {
            webview: {
                html: '',
                options: {},
                postMessage: sinon.stub().resolves(true),
                onDidReceiveMessage: sinon.stub().callsFake((cb: (msg: unknown) => void) => {
                    webviewHandlers.set(panel, cb)
                    return { dispose () {} }
                }),
                asWebviewUri: (uri: any) => ({ toString: () => uri?.toString?.() ?? 'test://uri' })
            },
            visible: true,
            title,
            reveal: sinon.stub(),
            onDidDispose: sinon.stub(),
            dispose: sinon.stub()
        }
        createdPanels.push(panel)
        return panel
    })

    const vscodeWindow = vscode.window as Record<string, unknown>
    vscodeWindow.createWebviewPanel = createWebviewPanel

    const telemetryLogger: MockTelemetryLogger = { logEvent: sinon.stub() }

    const onWorkspaceRefreshed = sinon.stub().returns({ dispose () {} })
    const onVariableRenamed = sinon.stub().returns({ dispose () {} })

    const manager = new VariableViewerPanelManager(
        context as any,
        service,
        mvm as any,
        telemetryLogger as any,
        onWorkspaceRefreshed as any,
        onVariableRenamed as any
    )
    activeManagers.push(manager)

    return {
        manager,
        service,
        serviceListener: serviceListener!,
        sendRequest,
        mvm,
        telemetryLogger,
        stateChangedCallback: stateChangedCallback!,
        promptChangeCallback: promptChangeCallback!,
        createdPanels,
        getLastPanel: () => createdPanels[createdPanels.length - 1],
        getWebviewHandler: (panel: MockWebviewPanel) => webviewHandlers.get(panel)!,
        dispose: () => manager.dispose()
    }
}
