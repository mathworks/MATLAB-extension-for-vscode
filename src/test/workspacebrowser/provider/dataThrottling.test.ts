// Copyright 2026 The MathWorks, Inc.

// Tests for data request throttling in WorkspaceBrowserProvider.
// Verifies that rapid DataChanged events are coalesced, that zero-row
// workspaces bypass the throttle, and that disconnect cancels pending timers.

import { expect } from 'chai'
import * as sinon from 'sinon'
import { createProviderTestHarness } from './helpers'

suite('WorkspaceBrowserProvider — data throttling', () => {
    // The MATLAB server fires DataChanged on every workspace mutation. A loop
    // creating 100 variables fires 100 events in rapid succession. Without
    // throttling, each would trigger a GetData round-trip, flooding the server
    // and causing visible UI lag. The 300ms debounce ensures at most one request
    // per interval, while the zero-row short-circuit handles workspace clear
    // operations without any delay.

    let clock: sinon.SinonFakeTimers

    setup(() => {
        clock = sinon.useFakeTimers()
    })

    teardown(() => {
        clock.restore()
        sinon.restore()
    })

    // Multiple events within the throttle window should produce exactly one request.
    // This is the primary correctness property of the throttle mechanism.
    test('rapid DataChanged events are coalesced into a single GetData request', () => {
        const { serverHandler, sendNotification } = createProviderTestHarness({ captureStateChanged: true })

        // Set initial size so the provider has a non-zero row count
        serverHandler({ type: 'Size', rowCount: 10, columnCount: 4 })
        clock.tick(300)
        sendNotification.resetHistory()

        // Fire multiple DataChanged events rapidly
        serverHandler({ type: 'DataChanged', rowCount: 10, columnCount: 4 })
        serverHandler({ type: 'DataChanged', rowCount: 10, columnCount: 4 })
        serverHandler({ type: 'DataChanged', rowCount: 10, columnCount: 4 })

        // Before throttle expires: no GetData sent
        const beforeThrottle = sendNotification.getCalls().filter(
            (c: sinon.SinonSpyCall) => c.args[1]?.type === 'GetData'
        )
        expect(beforeThrottle.length).to.equal(0)

        // After throttle expires: exactly one GetData sent
        clock.tick(300)
        const afterThrottle = sendNotification.getCalls().filter(
            (c: sinon.SinonSpyCall) => c.args[1]?.type === 'GetData'
        )
        expect(afterThrottle.length).to.equal(1)
    })

    // When the workspace is empty (e.g. after 'clear all'), the table should
    // clear instantly. Waiting 300ms for the throttle would make the UI feel
    // unresponsive. The zero-row check bypasses the throttle entirely.
    test('zero-row workspace bypasses throttle and sends empty data immediately', () => {
        const { serverHandler, postMessage } = createProviderTestHarness({ captureStateChanged: true })
        postMessage.resetHistory()

        // Size message with zero rows
        serverHandler({ type: 'Size', rowCount: 0, columnCount: 4 })

        // Should immediately post empty setData (no throttle delay)
        const setDataMsg = postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'setData'
        )
        expect(setDataMsg).to.not.be.undefined
        expect(setDataMsg?.args[0]?.rows).to.deep.equal([])
    })

    // If MATLAB disconnects while a throttled request is pending, the timer must
    // be cancelled. Otherwise the GetData fires after disconnect, the server is
    // gone, and we get an unhandled error or stale data on reconnection.
    test('disconnect cancels pending data request timer', () => {
        const { serverHandler, stateChangedCallback, sendNotification } = createProviderTestHarness({ captureStateChanged: true })

        // Trigger a throttled request
        serverHandler({ type: 'Size', rowCount: 5, columnCount: 4 })
        sendNotification.resetHistory()

        // Disconnect before the throttle fires
        stateChangedCallback('connected', 'disconnected')
        clock.tick(300)

        // GetData should NOT have been sent after disconnect
        const getDataCalls = sendNotification.getCalls().filter(
            (c: sinon.SinonSpyCall) => c.args[1]?.type === 'GetData'
        )
        expect(getDataCalls.length).to.equal(0)
    })
})
