// Copyright 2023-2024 The MathWorks, Inc.
import * as utils from './../tools/utils/VSCodeUtils'

suite('Connection Smoke Tests - File On Disk', () => {
    test('MATLAB should connect on opening a file from disk', async () => {
        await utils.openDocument('hScript1.m')
        await utils.assertMATLABConnected()
        // test format action to verify the connection is working
        await utils.formatActiveDocument()
        await utils.assertActiveDocumentContent('if true\n    disp hello\nend\n', 'Document content should be formatted')
    })

    test('Format should trigger MATLAB connection', async () => {
        await utils.openDocument('hScript1.m')
        await utils.disconnectFromMATLAB()
        await utils.assertMATLABDisconnected()
        await utils.formatActiveDocument()
        await utils.assertMATLABConnected()
        await utils.assertActiveDocumentContent('if true\n    disp hello\nend\n', 'Document content should be formatted')
    })
})
