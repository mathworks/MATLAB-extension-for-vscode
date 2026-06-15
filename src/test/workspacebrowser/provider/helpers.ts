// Copyright 2026 The MathWorks, Inc.

// Shared test factory for WorkspaceBrowserProvider tests.
// Provides a configurable mock setup so each test file can override
// only the pieces it needs without duplicating 40+ lines of boilerplate.

import * as sinon from 'sinon'
import WorkspaceBrowserProvider from '../../../workspacebrowser/WorkspaceBrowserProvider'
import Notification from '../../../notifications/Notifications'

// ── Mock Shapes ─────────────────────────────────────────────────

export interface MockNotifier {
    sendNotification: sinon.SinonStub
    onNotification: sinon.SinonStub
}

export interface MockMvm {
    getMatlabState: sinon.SinonStub | (() => string)
    getMatlabRelease: sinon.SinonStub | (() => string)
    getReadyPromise: sinon.SinonStub
    feval: sinon.SinonStub
    eval: sinon.SinonStub
    on: sinon.SinonStub
    isDebugging: sinon.SinonStub
}

export interface MockContext {
    extensionUri: { toString: () => string }
    workspaceState: { get: sinon.SinonStub, update: sinon.SinonStub }
    subscriptions: any[]
}

export interface MockWebviewView {
    webview: {
        options: Record<string, unknown>
        html: string
        asWebviewUri: (uri: any) => { toString: () => string }
        onDidReceiveMessage: sinon.SinonStub
        postMessage: sinon.SinonStub
    }
    onDidDispose: sinon.SinonStub
}

// ── Factory Options ─────────────────────────────────────────────

export interface ProviderTestOptions {
    // When true, captures the stateChanged callback from mvm.on (default: false)
    captureStateChanged?: boolean
    // When true, captures the webview message handler from onDidReceiveMessage (default: false)
    captureWebviewHandler?: boolean
}

// ── Factory Result ──────────────────────────────────────────────

export interface MockTelemetryLogger {
    logEvent: sinon.SinonStub
}

export interface ProviderTestHarness {
    provider: WorkspaceBrowserProvider
    serverHandler: (msg: Record<string, unknown>) => void
    sendNotification: sinon.SinonStub
    postMessage: sinon.SinonStub
    mvm: MockMvm
    context: MockContext
    webviewView: MockWebviewView
    telemetryLogger: MockTelemetryLogger
    // Only populated when captureStateChanged is true
    stateChangedCallback: (oldState: string, newState: string) => void
    // Only populated when captureWebviewHandler is true
    webviewHandler: (msg: Record<string, unknown>) => void
}

// ── Factory Function ────────────────────────────────────────────

// Creates a fully wired WorkspaceBrowserProvider with stubbed dependencies,
// resolves the webview view, and returns all the handles needed to drive tests.
export function createProviderTestHarness (options: ProviderTestOptions = {}): ProviderTestHarness {
    let serverHandler: ((msg: Record<string, unknown>) => void) | undefined
    let stateChangedCallback: ((oldState: string, newState: string) => void) | undefined
    let webviewHandler: ((msg: Record<string, unknown>) => void) | undefined

    // ── Notifier ────────────────────────────────────────────────
    const sendNotification = sinon.stub()
    const onNotification = sinon.stub().callsFake((tag: string, cb: (msg: Record<string, unknown>) => void) => {
        if (tag === Notification.WSBServerMessage) {
            serverHandler = cb
        }
        return { dispose: () => {} }
    })
    const notifier: MockNotifier = { sendNotification, onNotification }

    // ── MVM ─────────────────────────────────────────────────────
    const mvmOn = sinon.stub().callsFake((event: string, cb: (...args: any[]) => void) => {
        if (options.captureStateChanged === true && event === 'stateChanged') {
            stateChangedCallback = cb
        }
        return { dispose: () => {} }
    })
    const mvm: MockMvm = {
        getMatlabState: sinon.stub().returns('disconnected'),
        getMatlabRelease: sinon.stub().returns('R2024a'),
        getReadyPromise: sinon.stub().resolves(),
        feval: sinon.stub().resolves({ result: ['preview text'] }),
        eval: sinon.stub().resolves(),
        on: mvmOn,
        isDebugging: sinon.stub().returns(false)
    }

    // ── Extension Context ───────────────────────────────────────
    const context: MockContext = {
        extensionUri: { toString: () => 'test://ext' },
        workspaceState: {
            get: sinon.stub().returns(undefined),
            update: sinon.stub().resolves()
        },
        subscriptions: []
    }

    // ── Telemetry Logger ──────────────────────────────────────────
    const telemetryLogger: MockTelemetryLogger = { logEvent: sinon.stub() }

    // ── Provider Construction ───────────────────────────────────
    const provider = new WorkspaceBrowserProvider(context as any, notifier as any, mvm as any, telemetryLogger as any)

    // ── Webview View ────────────────────────────────────────────
    const postMessage = sinon.stub().resolves(true)
    const onDidReceiveMessage = sinon.stub().callsFake((cb: (msg: Record<string, unknown>) => void) => {
        if (options.captureWebviewHandler === true) {
            webviewHandler = cb
        }
        return { dispose: () => {} }
    })
    const webviewView: MockWebviewView = {
        webview: {
            options: {},
            html: '',
            asWebviewUri: (uri: any) => ({ toString: () => uri?.toString?.() ?? 'test://uri' }),
            onDidReceiveMessage,
            postMessage
        },
        onDidDispose: sinon.stub()
    }
    provider.resolveWebviewView(webviewView as any, {} as any, { isCancellationRequested: false } as any)

    return {
        provider,
        serverHandler: serverHandler!,
        sendNotification,
        postMessage,
        mvm,
        context,
        webviewView,
        telemetryLogger,
        stateChangedCallback: stateChangedCallback!,
        webviewHandler: webviewHandler!
    }
}
