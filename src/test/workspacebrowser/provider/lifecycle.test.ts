// Copyright 2026 The MathWorks, Inc.

// Tests for MATLAB connect/disconnect lifecycle handling in WorkspaceBrowserProvider.
// Verifies that state changes trigger the correct HTML updates, startup eval,
// cache clearing, and resolveWebviewView produces appropriate HTML for each state.

import { expect } from 'chai'
import * as sinon from 'sinon'
import WorkspaceBrowserProvider from '../../../workspacebrowser/WorkspaceBrowserProvider'

// ── Helpers ──────────────────────────────────────────────────────

function createProviderComponents (): {
    provider: WorkspaceBrowserProvider
    mvm: {
        getMatlabState: sinon.SinonStub
        getMatlabRelease: sinon.SinonStub
        getReadyPromise: sinon.SinonStub
        feval: sinon.SinonStub
        eval: sinon.SinonStub
        on: sinon.SinonStub
    }
    stateChangedCallback: (oldState: string, newState: string) => void
    sendNotification: sinon.SinonStub
    telemetryLogger: { logEvent: sinon.SinonStub }
} {
    let stateChangedCallback: ((oldState: string, newState: string) => void) | undefined

    const sendNotification = sinon.stub()
    const onNotification = sinon.stub().returns({ dispose: () => {} })
    const notifier = { sendNotification, onNotification }

    const mvm = {
        getMatlabState: sinon.stub().returns('disconnected'),
        getMatlabRelease: sinon.stub().returns('R2024a'),
        getReadyPromise: sinon.stub().resolves(),
        feval: sinon.stub().resolves({ result: [] }),
        eval: sinon.stub().resolves(),
        on: sinon.stub().callsFake((event: string, cb: (...args: any[]) => void) => {
            if (event === 'stateChanged') {
                stateChangedCallback = cb
            }
            return { dispose: () => {} }
        })
    }

    const context = {
        extensionUri: { toString: () => 'test://ext' },
        workspaceState: { get: sinon.stub().returns(undefined), update: sinon.stub().resolves() },
        subscriptions: []
    }

    const telemetryLogger = { logEvent: sinon.stub() }
    const provider = new WorkspaceBrowserProvider(context as any, notifier as any, mvm as any, telemetryLogger as any)

    return { provider, mvm, stateChangedCallback: stateChangedCallback!, sendNotification, telemetryLogger }
}

function createWebviewView (): { webviewView: any, postMessage: sinon.SinonStub, triggerDispose: () => void } {
    let disposeCallback: (() => void) | undefined
    const postMessage = sinon.stub().resolves(true)
    const webviewView = {
        webview: {
            options: {},
            html: '',
            asWebviewUri: (uri: any) => ({ toString: () => uri?.toString?.() ?? 'test://uri' }),
            onDidReceiveMessage: sinon.stub().returns({ dispose: () => {} }),
            postMessage
        },
        onDidDispose: sinon.stub().callsFake((cb: () => void) => { disposeCallback = cb })
    }
    return { webviewView, postMessage, triggerDispose: () => disposeCallback?.() }
}

suite('WorkspaceBrowserProvider — lifecycle', () => {
    teardown(() => {
        sinon.restore()
    })

    // ── resolveWebviewView ───────────────────────────────────────
    // resolveWebviewView is called by VS Code when the sidebar panel becomes
    // visible. The HTML it generates depends on the current MATLAB connection
    // state. Getting this wrong means users see a blank panel or a confusing
    // error. Each connection state has its own HTML variant.

    suite('resolveWebviewView', () => {
        test('shows disconnected HTML when MATLAB is not connected', () => {
            const { provider } = createProviderComponents()
            const { webviewView } = createWebviewView()

            provider.resolveWebviewView(webviewView, {} as any, { isCancellationRequested: false } as any)

            expect(webviewView.webview.html).to.include('Disconnected')
        })

        test('shows unsupported HTML when MATLAB version is too old', () => {
            const { provider, mvm } = createProviderComponents()
            mvm.getMatlabState.returns('connected')
            mvm.getMatlabRelease.returns('R2022b')
            const { webviewView } = createWebviewView()

            provider.resolveWebviewView(webviewView, {} as any, { isCancellationRequested: false } as any)

            expect(webviewView.webview.html).to.include('R2023a')
            expect(webviewView.webview.html).to.include('or later')
        })

        test('logs wsbPanelOpened telemetry event', () => {
            const { provider, telemetryLogger } = createProviderComponents()
            const { webviewView } = createWebviewView()

            provider.resolveWebviewView(webviewView, {} as any, { isCancellationRequested: false } as any)

            expect(telemetryLogger.logEvent.calledOnce).to.be.true
            expect(telemetryLogger.logEvent.firstCall.args[0]).to.deep.equal({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbPanelOpened', result: '' }
            })
        })

        test('logs wsbPanelClosed telemetry event on dispose', () => {
            const { provider, telemetryLogger } = createProviderComponents()
            const { webviewView, triggerDispose } = createWebviewView()

            provider.resolveWebviewView(webviewView, {} as any, { isCancellationRequested: false } as any)
            telemetryLogger.logEvent.resetHistory()

            triggerDispose()

            expect(telemetryLogger.logEvent.calledOnce).to.be.true
            expect(telemetryLogger.logEvent.firstCall.args[0]).to.deep.equal({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'wsbPanelClosed', result: '' }
            })
        })

        test('shows full interactive HTML when MATLAB is connected and supported', () => {
            const { provider, mvm } = createProviderComponents()
            mvm.getMatlabState.returns('connected')
            mvm.getMatlabRelease.returns('R2024a')
            const { webviewView } = createWebviewView()

            provider.resolveWebviewView(webviewView, {} as any, { isCancellationRequested: false } as any)

            // Full HTML includes the table structure and bundle script
            expect(webviewView.webview.html).to.include('wsb-table')
            expect(webviewView.webview.html).to.include('bundle.js')
        })
    })

    // ── Connect/Disconnect ───────────────────────────────────────
    // The provider listens for MVM.Events.stateChanged and handles connect/disconnect
    // internally — extension.ts no longer calls onMatlabConnected/onMatlabDisconnected.
    // On connect: the provider must run the startup eval (which registers the WSB
    // backend in MATLAB) and request the initial workspace size.
    // On disconnect: caches must be cleared and the webview replaced with
    // disconnected HTML so stale data is never shown after reconnection.

    suite('MATLAB state changes', () => {
        test('connect triggers startup eval and GetSize request', () => {
            const { provider, mvm, stateChangedCallback, sendNotification } = createProviderComponents()
            const { webviewView } = createWebviewView()
            provider.resolveWebviewView(webviewView, {} as any, { isCancellationRequested: false } as any)

            mvm.getMatlabState.returns('connected')
            mvm.getMatlabRelease.returns('R2024a')
            sendNotification.resetHistory()

            // Simulate MATLAB connecting
            stateChangedCallback('disconnected', 'connected')

            // Should run the startup command
            expect(mvm.eval.called).to.be.true
            expect(mvm.eval.firstCall.args[0]).to.include('MobileWorkspaceBrowser.startup')

            // Should request workspace size
            const getSizeCall = sendNotification.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[1]?.type === 'GetSize'
            )
            expect(getSizeCall).to.not.be.undefined
        })

        test('disconnect shows disconnected HTML', () => {
            const { provider, stateChangedCallback } = createProviderComponents()
            const { webviewView } = createWebviewView()
            provider.resolveWebviewView(webviewView, {} as any, { isCancellationRequested: false } as any)

            // Simulate MATLAB disconnecting
            stateChangedCallback('connected', 'disconnected')

            expect(webviewView.webview.html).to.include('Disconnected')
        })

        test('connect with unsupported version shows unsupported HTML', () => {
            const { provider, mvm, stateChangedCallback } = createProviderComponents()
            const { webviewView } = createWebviewView()
            provider.resolveWebviewView(webviewView, {} as any, { isCancellationRequested: false } as any)

            mvm.getMatlabState.returns('connected')
            mvm.getMatlabRelease.returns('R2020a')

            stateChangedCallback('disconnected', 'connected')

            expect(webviewView.webview.html).to.include('R2023a')
        })
    })
})
