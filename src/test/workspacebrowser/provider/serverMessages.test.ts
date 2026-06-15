// Copyright 2026 The MathWorks, Inc.

// Tests for server message handling in WorkspaceBrowserProvider.
// Verifies that each WSBServerMessage type triggers the correct
// webview postMessage and internal cache updates.

import { expect } from 'chai'
import * as sinon from 'sinon'
import { createProviderTestHarness } from './helpers'

suite('WorkspaceBrowserProvider — server messages', () => {
    // The provider receives workspace data from the MATLAB language server via
    // WSBServerMessage notifications. Each message type triggers specific actions:
    // caching data, posting to the webview, or requesting more data from the server.
    // These tests verify the dispatch logic by directly invoking the registered
    // notification handler and asserting on the resulting sendNotification and
    // postMessage calls.

    let clock: sinon.SinonFakeTimers

    setup(() => {
        clock = sinon.useFakeTimers()
    })

    teardown(() => {
        clock.restore()
        sinon.restore()
    })

    // Size is the first message after GetSize — it tells us how many rows/columns
    // exist. If the column count changed, we need to re-fetch column definitions
    // because the server may have added or removed columns.
    test('Size message requests GetVisibleColumns when column count changes', () => {
        const { serverHandler, sendNotification } = createProviderTestHarness()
        serverHandler({ type: 'Size', rowCount: 5, columnCount: 4 })

        const getVisibleCols = sendNotification.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[1]?.type === 'GetVisibleColumns'
        )
        expect(getVisibleCols).to.not.be.undefined
    })

    // Data requests are throttled to prevent flooding the server when rapid
    // Size/DataChanged events arrive (e.g. during a loop that creates variables).
    // The 300ms debounce ensures at most one GetData per interval.
    test('Size message schedules a throttled GetData request', () => {
        const { serverHandler, sendNotification } = createProviderTestHarness()
        sendNotification.resetHistory()

        serverHandler({ type: 'Size', rowCount: 3, columnCount: 4 })

        // Data request should not fire immediately (throttled)
        const immediateGetData = sendNotification.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[1]?.type === 'GetData'
        )
        expect(immediateGetData).to.be.undefined

        // After the throttle delay, GetData should fire
        clock.tick(300)
        const delayedGetData = sendNotification.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[1]?.type === 'GetData'
        )
        expect(delayedGetData).to.not.be.undefined
    })

    // Column definitions tell the webview what headers to render and which columns
    // are sortable/resizable. They are cached so they can be replayed on webview ready.
    test('Columns message posts setColumns to webview', () => {
        const { serverHandler, postMessage } = createProviderTestHarness()
        serverHandler({
            type: 'Columns',
            columns: [
                { name: 'Name', label: 'Name' },
                { name: 'Value', label: 'Value' }
            ]
        })

        const setColumnsMsg = postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'setColumns'
        )
        expect(setColumnsMsg).to.not.be.undefined
    })

    // The Value column displays formatted strings that don't sort meaningfully
    // on the server side. Marking it non-sortable prevents the webview from
    // showing a sort indicator that would mislead users.
    test('Columns message marks Value column as non-sortable', () => {
        const { serverHandler, postMessage } = createProviderTestHarness()
        serverHandler({
            type: 'Columns',
            columns: [
                { name: 'Name', label: 'Name' },
                { name: 'Value', label: 'Value' }
            ]
        })

        const setColumnsMsg = postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'setColumns'
        )
        const valueCol = setColumnsMsg?.args[0]?.columns?.find(
            (col: any) => col.name === 'Value'
        )
        expect(valueCol?.sortable).to.be.false
    })

    // Data rows arrive with capitalized field names from the server (Name, Class,
    // Size, Value). The provider normalizes them to lowercase to match the
    // WorkspaceVariable interface. This test verifies the field mapping.
    test('Data message posts setData to webview with parsed rows', () => {
        const { serverHandler, postMessage } = createProviderTestHarness()
        serverHandler({
            type: 'Data',
            data: [
                { Name: 'x', Class: 'double', Size: '1x1', Value: '42' }
            ]
        })

        const setDataMsg = postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'setData'
        )
        expect(setDataMsg).to.not.be.undefined
        expect(setDataMsg?.args[0]?.rows).to.have.length(1)
        expect(setDataMsg?.args[0]?.rows[0]?.name).to.equal('x')
    })

    // The server sends rows as positional arrays (data: [val0, val1, ...]) matched
    // against the cached column order. This is the production code path — the flat
    // object fallback only runs if columns haven't arrived yet.
    test('Data message with positional arrays maps fields using cached column order', () => {
        const { serverHandler, postMessage } = createProviderTestHarness()

        // Populate column cache so the positional path is used
        serverHandler({
            type: 'Columns',
            columns: [
                { column: 'Name', label: 'Name' },
                { column: 'Class', label: 'Class' },
                { column: 'Size', label: 'Size' },
                { column: 'Value', label: 'Value' }
            ]
        })
        postMessage.resetHistory()

        // Send data in positional array format (production format)
        serverHandler({
            type: 'Data',
            data: [
                { data: ['myVar', 'double', '1x1', '42'], rowNum: 1 },
                { data: ['arr', 'cell', '3x2', '{3x2 cell}'], rowNum: 2 }
            ]
        })

        const setDataMsg = postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'setData'
        )
        expect(setDataMsg).to.not.be.undefined
        const rows = setDataMsg?.args[0]?.rows
        expect(rows).to.have.length(2)
        expect(rows[0].name).to.equal('myVar')
        expect(rows[0].fields.Class).to.equal('double')
        expect(rows[0].fields.Size).to.equal('1x1')
        expect(rows[0].fields.Value).to.equal('42')
        expect(rows[1].name).to.equal('arr')
        expect(rows[1].fields.Class).to.equal('cell')
    })

    // DataChanged fires whenever the workspace mutates (variable created, deleted,
    // or modified). It must trigger a fresh data fetch, but through the throttle
    // to coalesce bursts from rapid MATLAB operations.
    test('DataChanged message schedules a throttled data re-request', () => {
        const { serverHandler, sendNotification } = createProviderTestHarness()

        // First set a non-zero row count via Size
        serverHandler({ type: 'Size', rowCount: 2, columnCount: 4 })
        clock.tick(300)
        sendNotification.resetHistory()

        // DataChanged should trigger another throttled request
        serverHandler({ type: 'DataChanged', rowCount: 3, columnCount: 4 })
        clock.tick(300)

        const getData = sendNotification.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[1]?.type === 'GetData'
        )
        expect(getData).to.not.be.undefined
    })

    // InternalError is a catch-all from the server for unexpected conditions.
    // The provider must log it but never throw — a crash here would kill the
    // entire notification handler and silently break all subsequent messages.
    test('InternalError message does not crash the provider', () => {
        const { serverHandler } = createProviderTestHarness()
        // Should log but not throw
        expect(() => {
            serverHandler({ type: 'InternalError', message: 'test error' })
        }).to.not.throw()
    })

    // WorkspaceBrowserStarted signals the MATLAB backend has finished initializing.
    // Only at this point can the server respond with the real column configuration,
    // so the provider must request both size and columns here.
    test('WorkspaceBrowserStarted requests GetSize and GetVisibleColumns', () => {
        const { serverHandler, sendNotification } = createProviderTestHarness()
        sendNotification.resetHistory()

        serverHandler({ type: 'WorkspaceBrowserStarted' })

        const getSize = sendNotification.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[1]?.type === 'GetSize'
        )
        const getVisibleCols = sendNotification.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[1]?.type === 'GetVisibleColumns'
        )
        expect(getSize).to.not.be.undefined
        expect(getVisibleCols).to.not.be.undefined
    })
})
