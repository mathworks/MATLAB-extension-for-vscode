// Copyright 2023-2024 The MathWorks, Inc.
import * as utils from './../tools/utils/VSCodeUtils'

suite('Connection Smoke Tests - New Buffer', () => {
    test('Creating a new m file should trigger MATLAB connection', async () => {
        await utils.openNewDocument()
        await utils.assertMATLABConnected()
    })
})
