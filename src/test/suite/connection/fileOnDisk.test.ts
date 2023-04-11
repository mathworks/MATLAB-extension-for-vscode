// Copyright 2023 The MathWorks, Inc.

import { before } from 'mocha'
import * as vs from '../../tester/VSCodeTester'

suite('Connection Smoke Tests - File On Disk', () => {
    before(async () => {
        await vs.closeAllDocuments()
    })

    test('MATLAB should connect on opening a file from disk', async () => {
        await vs.openDocument('hScript1.m')
        await vs.assertMATLABConnected()
        // test format action to verify the connection is working
        await vs.formatActiveDocument()
        await vs.assertActiveDocumentContent('if true\n    disp hello\nend\n', 'Document content should be formatted')
        await vs.closeActiveDocument()
    })

    test('Format should trigger MATLAB connection', async () => {
        await vs.openDocument('hScript1.m')
        await vs.disconnectFromMATLAB()
        await vs.assertMATLABDisconnected()
        await vs.formatActiveDocument()
        await vs.assertMATLABConnected()
        await vs.assertActiveDocumentContent('if true\n    disp hello\nend\n', 'Document content should be formatted')
        await vs.closeActiveDocument()
    })
})
