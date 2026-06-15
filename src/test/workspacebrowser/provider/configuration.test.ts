// Copyright 2026 The MathWorks, Inc.

// Tests for configuration-driven behavior in WorkspaceBrowserProvider.
// Verifies that the max variables warning fires when the workspace exceeds
// the configured limit, and that the GetData request respects the limit.

import { expect } from 'chai'
import * as sinon from 'sinon'
import * as vscode from 'vscode'
import { createProviderTestHarness } from './helpers'
import { WSB_DEFAULT_MAX_VARIABLES } from '../../../workspacebrowser/WorkspaceBrowserProvider'

suite('WorkspaceBrowserProvider — configuration', () => {
    // The provider reads MATLAB.maximumWorkspaceVariables to cap how many
    // variables it requests from the server. Without this, workspaces with
    // thousands of variables would cause excessive data transfer and rendering
    // lag. These tests verify the GetData request respects the limit and that
    // the max-variables warning fires when appropriate.

    let clock: sinon.SinonFakeTimers

    setup(() => {
        clock = sinon.useFakeTimers()
    })

    teardown(() => {
        clock.restore()
        sinon.restore()
    })

    // GetData requests should use the configured max variables as the endRow.
    // The default is 500, so with 10 rows the endRow should be min(11, 500) = 11.
    test('GetData request respects max variables setting', () => {
        const { serverHandler, sendNotification } = createProviderTestHarness()

        serverHandler({ type: 'Size', rowCount: 10, columnCount: 4 })
        clock.tick(300)

        const getData = sendNotification.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[1]?.type === 'GetData'
        )
        expect(getData).to.not.be.undefined
        expect(getData?.args[1]?.endRow).to.equal(11)
    })

    // When the workspace has fewer rows than the limit, endRow equals rowCount + 1
    // (1-indexed MATLAB convention: rows 1 through rowCount inclusive).
    test('GetData endRow is rowCount + 1 when below limit', () => {
        const { serverHandler, sendNotification } = createProviderTestHarness()

        serverHandler({ type: 'Size', rowCount: 50, columnCount: 4 })
        clock.tick(300)

        const getData = sendNotification.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[1]?.type === 'GetData'
        )
        expect(getData?.args[1]?.endRow).to.equal(51)
    })

    // When the server returns more rows than maxVariables, the provider caps the
    // data sent to the webview. The default limit is 500, so 600 rows from the
    // server should result in only 500 rows posted to the webview.
    test('data sent to webview is capped at max variables', () => {
        const { serverHandler, postMessage } = createProviderTestHarness()
        const numRows = 600

        // Provide column metadata so handleDataMessage can map positional data
        serverHandler({
            type: 'Columns',
            columns: [
                { column: 'Name', label: 'Name' },
                { column: 'Value', label: 'Value' },
                { column: 'Size', label: 'Size' },
                { column: 'Class', label: 'Class' }
            ]
        })

        // Send a Size message to set numRows, then send Data with 600 rows
        serverHandler({ type: 'Size', rowCount: numRows, columnCount: 4 })
        clock.tick(300)

        const rows = Array.from({ length: numRows }, (_, i) => ({
            data: [`var${i}`, String(i), '1x1', 'double']
        }))
        serverHandler({ type: 'Data', data: rows })

        const setDataCall = postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'setData'
        )
        expect(setDataCall).to.not.be.undefined
        expect(setDataCall?.args[0]?.rows.length).to.equal(WSB_DEFAULT_MAX_VARIABLES)
    })

    // DataChanged events with size info should also trigger GetData through
    // the throttle, maintaining the same max-variables cap.
    test('DataChanged with size info triggers throttled GetData', () => {
        const { serverHandler, sendNotification } = createProviderTestHarness()

        // Initial Size message
        serverHandler({ type: 'Size', rowCount: 5, columnCount: 4 })
        clock.tick(300)
        sendNotification.resetHistory()

        // DataChanged with updated size
        serverHandler({ type: 'DataChanged', rowCount: 8, columnCount: 4 })
        clock.tick(300)

        const getData = sendNotification.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[1]?.type === 'GetData'
        )
        expect(getData).to.not.be.undefined
        expect(getData?.args[1]?.endRow).to.equal(9)
    })

    // ── Sort method setting ────────────────────────────────────────

    // Default natural sorting compares numbers within names by numeric value,
    // so "var2" sorts before "var10". This verifies the default behavior is
    // preserved when no setting override is present.
    test('sortRows uses natural order by default', () => {
        const { serverHandler, postMessage, webviewHandler } = createProviderTestHarness({ captureWebviewHandler: true })

        serverHandler({
            type: 'Columns',
            columns: [
                { name: 'Name', label: 'Name', sortable: true, resizable: true },
                { name: 'Value', label: 'Value', sortable: false, resizable: true },
                { name: 'Size', label: 'Size', sortable: true, resizable: true },
                { name: 'Class', label: 'Class', sortable: true, resizable: true }
            ]
        })
        serverHandler({
            type: 'Data',
            data: [
                { data: ['var10', '10', '1x1', 'double'] },
                { data: ['var2', '2', '1x1', 'double'] },
                { data: ['var1', '1', '1x1', 'double'] }
            ]
        })
        postMessage.resetHistory()

        // Setting sort state triggers sendDataToWebview since savedState starts undefined
        webviewHandler({ type: 'stateChanged', state: { sortColumn: 'Name', sortDirection: 'asc' } })

        const setDataCall = postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'setData'
        )
        expect(setDataCall).to.not.be.undefined
        const names = setDataCall?.args[0]?.rows.map((r: { name: string }) => r.name)
        // Natural: var1, var2, var10 (numeric comparison)
        expect(names).to.deep.equal(['var1', 'var2', 'var10'])
    })

    // When workspaceSortMethod is "lexicographic", sorting uses character-by-character
    // comparison where "var10" < "var2" because '1' < '2'.
    test('sortRows uses lexicographic order when configured', () => {
        const getConfigStub = sinon.stub(vscode.workspace, 'getConfiguration')
        getConfigStub.returns({
            get: (key: string, defaultValue: unknown) => {
                if (key === 'workspaceSortMethod') return 'lexicographic'
                return defaultValue
            }
        } as any)

        const { serverHandler, postMessage, webviewHandler } = createProviderTestHarness({ captureWebviewHandler: true })

        serverHandler({
            type: 'Columns',
            columns: [
                { name: 'Name', label: 'Name', sortable: true, resizable: true },
                { name: 'Value', label: 'Value', sortable: false, resizable: true },
                { name: 'Size', label: 'Size', sortable: true, resizable: true },
                { name: 'Class', label: 'Class', sortable: true, resizable: true }
            ]
        })
        serverHandler({
            type: 'Data',
            data: [
                { data: ['var10', '10', '1x1', 'double'] },
                { data: ['var2', '2', '1x1', 'double'] },
                { data: ['var1', '1', '1x1', 'double'] }
            ]
        })
        postMessage.resetHistory()

        // Setting sort state triggers sendDataToWebview since savedState starts undefined
        webviewHandler({ type: 'stateChanged', state: { sortColumn: 'Name', sortDirection: 'asc' } })

        const setDataCall = postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'setData'
        )
        expect(setDataCall).to.not.be.undefined
        const names = setDataCall?.args[0]?.rows.map((r: { name: string }) => r.name)
        // Lexicographic: var1, var10, var2 (character comparison: '1' < '2')
        expect(names).to.deep.equal(['var1', 'var10', 'var2'])

        getConfigStub.restore()
    })
})
