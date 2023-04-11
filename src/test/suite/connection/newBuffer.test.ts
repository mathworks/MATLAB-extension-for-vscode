// Copyright 2023 The MathWorks, Inc.

import { before } from 'mocha'
import * as vs from '../../tester/VSCodeTester'

suite('Connection Smoke Tests - New Buffer', () => {
    before(async () => {
        await vs.closeAllDocuments()
    })

    test('Creating a new m file should trigger MATLAB connection', async () => {
        await vs.openNewDocument()
        await vs.assertMATLABConnected()
        await vs.closeActiveDocument()
    })
})
