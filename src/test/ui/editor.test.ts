// Copyright 2025 The MathWorks, Inc.
import { VSCodeTester } from '../tools/tester/VSCodeTester'
import { before, after } from 'mocha';

suite('Editor UI Tests', () => {
    let vs: VSCodeTester

    before(async () => {
        vs = new VSCodeTester();
    });

    after(async () => {
        await vs.disconnectFromMATLAB()
    });

    test('Test editor section', async () => {
        const editor = await vs.openEditor('hSectionsScript.m')
        await vs.assertMATLABConnected()
        await editor.assertDecorationOnLine(5, 'Line 5 should have section decoration')
        await vs.closeActiveEditor()
    })
});
