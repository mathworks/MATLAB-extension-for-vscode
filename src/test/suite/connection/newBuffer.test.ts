// Copyright 2023 The MathWorks, Inc.
import * as vs from '../../tester/VSCodeTester'

suite('Connection Smoke Tests - New Buffer', () => {
    test('Creating a new m file should trigger MATLAB connection', async () => {
        await vs.openNewDocument()
        await vs.assertMATLABConnected()
    })
})
