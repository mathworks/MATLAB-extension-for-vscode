// Copyright 2025 The MathWorks, Inc.
import { VSCodeTester } from '../tools/tester/VSCodeTester'
import { before, after } from 'mocha';

suite('Execution UI Tests', () => {
    let vs: VSCodeTester

    before(async () => {
        vs = new VSCodeTester();
        await vs.openEditor('hScript1.m')
        await vs.assertMATLABConnected()
        await vs.closeActiveEditor()
        await vs.openMATLABTerminal()
    });

    after(async () => {
        await vs.disconnectFromMATLAB()
    });

    test('Test run section', async () => {
        // Script file has a = 1 in first section and prints a in second section
        const editor = await vs.openEditor('hSectionsScript.m')
        await vs.terminal.executeCommand('a = 0; clc')
        await editor.setCursor(5, 1) // Setting cursor on second section
        await vs.runCurrentSection()
        await vs.terminal.assertContains('0', 'Value of a should not be updated')
    })
});
