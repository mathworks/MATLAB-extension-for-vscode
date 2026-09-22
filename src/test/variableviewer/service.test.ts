// Copyright 2026 The MathWorks, Inc.

// Tests for VariableViewerService: verifies notification subscription,
// request forwarding, response routing, and disposal.

import { expect } from 'chai'
import * as sinon from 'sinon'
import Notification from '../../notifications/Notifications'
import VariableViewerService from '../../variableviewer/VariableViewerService'
import { VVClientRequest, VVServerResponse } from '../../variableviewer/types'

// ── Helpers ──────────────────────────────────────────────────────

interface MockNotifier {
    sendNotification: sinon.SinonStub
    onNotification: sinon.SinonStub
}

/**
 * Creates a VariableViewerService wired to stubbed dependencies.
 * Captures the VVServerMessage callback so tests can simulate server responses,
 * and exposes the dispose stub so tests can verify cleanup.
 */
function createServiceHarness (): {
    service: VariableViewerService
    notifier: MockNotifier
    serverHandler: (msg: Record<string, unknown>) => void
    dispose: sinon.SinonStub
} {
    let serverHandler: ((msg: Record<string, unknown>) => void) | undefined
    const dispose = sinon.stub()

    const notifier: MockNotifier = {
        sendNotification: sinon.stub(),
        onNotification: sinon.stub().callsFake((tag: string, cb: (msg: Record<string, unknown>) => void) => {
            if (tag === Notification.VVServerMessage) {
                serverHandler = cb
            }
            return { dispose }
        })
    }

    const service = new VariableViewerService(notifier as any)

    return { service, notifier, serverHandler: serverHandler!, dispose }
}

// ── Tests ────────────────────────────────────────────────────────

suite('VariableViewerService', () => {
    let sandbox: sinon.SinonSandbox

    setup(() => {
        sandbox = sinon.createSandbox()
    })

    teardown(() => {
        sandbox.restore()
    })

    // Verifies that the service registers itself to receive server-pushed notifications
    test('subscribes to VVServerMessage on construction', () => {
        const { notifier } = createServiceHarness()

        expect(notifier.onNotification.calledOnce).to.equal(true)
        expect(notifier.onNotification.firstCall.args[0]).to.equal(Notification.VVServerMessage)
    })

    // Verifies that client requests are sent on the correct notification channel with the full payload
    test('sendRequest forwards request via VVClientMessage notification', () => {
        const { service, notifier } = createServiceHarness()

        const request: VVClientRequest = { type: 'QueryVariable', varName: 'myVar' }
        service.sendRequest(request)

        expect(notifier.sendNotification.calledOnce).to.equal(true)
        expect(notifier.sendNotification.firstCall.args[0]).to.equal(Notification.VVClientMessage)
        expect(notifier.sendNotification.firstCall.args[1]).to.deep.equal(request)
    })

    // Verifies that server responses are routed to the registered listener
    test('invokes response listener when server message arrives', () => {
        const { service, serverHandler } = createServiceHarness()
        const listener = sinon.stub()
        service.setResponseListener(listener)

        const response: VVServerResponse = {
            type: 'VariableResponse',
            varName: 'data',
            metadata: { dataType: 'double', size: [3, 4], isSparse: false, isTall: false }
        }
        serverHandler(response as unknown as Record<string, unknown>)

        expect(listener.calledOnce).to.equal(true)
        expect(listener.firstCall.args[0]).to.deep.equal(response)
    })

    // Verifies graceful handling when no listener is registered (early server messages before panel manager starts)
    test('does not throw when server message arrives with no listener set', () => {
        const { serverHandler } = createServiceHarness()

        const response: VVServerResponse = {
            type: 'VariableDeleted',
            varName: 'gone'
        }

        expect(() => serverHandler(response as unknown as Record<string, unknown>)).to.not.throw()
    })

    // Verifies that disposal tears down the notification subscription to prevent leaks
    test('dispose cleans up notification subscription', () => {
        const { service, dispose } = createServiceHarness()

        service.dispose()

        expect(dispose.calledOnce).to.equal(true)
    })
})
