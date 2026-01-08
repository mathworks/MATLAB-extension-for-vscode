// Copyright 2025 The MathWorks, Inc.
import { Key } from 'vscode-extension-tester';
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
        await vs.terminal.executeCommand(`addpath('${vs.getTestFilesDirectory()}')`)
    });

    after(async () => {
        await vs.disconnectFromMATLAB()
    });

    test('Test run section', async () => {
        // Script file has a = 1 in first section and prints a in second section
        const editor = await vs.openEditor('hSectionsScript.m')
        await vs.terminal.executeCommand('a = 0; clc')
        await editor.setCursor(5, 1) // Setting cursor on second section
        await editor.type(Key.chord(Key.CONTROL, Key.ENTER), 'Ctrl+Enter to run section');
        await vs.terminal.assertContains('0', 'Value of a should not be updated')
    })

    test('Test pause and resume', async () => {
        const editor = await vs.openEditor('hPauseScript.m')
        await vs.runCurrentFile()
        await vs.pause(2500) // Allow execution for a few seconds
        await editor.type(Key.F6, 'F6 to pause')
        await editor.debugger.assertDebugging()
        await editor.type(Key.F5, 'F5 to resume')
        await editor.debugger.assertNotDebugging()
    })
});
