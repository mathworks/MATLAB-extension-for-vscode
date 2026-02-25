// Copyright 2025 The MathWorks, Inc.
import { Key } from 'vscode-extension-tester';
import { VSCodeTester } from '../tools/tester/VSCodeTester'
import { before, afterEach, after } from 'mocha';

suite('Debugging UI Tests', () => {
    let vs: VSCodeTester

    before(async () => {
        vs = new VSCodeTester();
        await vs.openEditor('hScript1.m')
        await vs.assertMATLABConnected()
        await vs.openMATLABTerminal()
        await vs.terminal.assertContains('>>', 'wait for ready prompt')
        await vs.terminal.executeCommand(`addpath('${vs.getTestFilesDirectory()}'); clc`)
        await vs.closeActiveEditor()
    });

    afterEach(async () => {
        await vs.terminal.executeCommand('dbclear all, clc')
        await vs.closeActiveEditor()
    });

    after(async () => {
        await vs.disconnectFromMATLAB()
    });

    test('Basic debugging operations', async () => {
        const editor = await vs.openEditor('hScript2.m')
        await editor.debugger.setBreakpointOnLine(1)
        await editor.debugger.setBreakpointOnLine(3)
        await editor.type(Key.F5, 'F5 to run file');
        await editor.debugger.assertStoppedAtLine(1)
        await editor.type(Key.F5, 'F5 to continue');
        await editor.debugger.assertStoppedAtLine(3)
        await editor.type(Key.F10, 'F10 to step over');
        await editor.debugger.assertStoppedAtLine(4)
        await editor.type(Key.chord(Key.SHIFT, Key.F5), 'Shift+F5 to stop');
        await editor.debugger.assertNotDebugging()
        await editor.debugger.clearBreakpointOnLine(1)
        await editor.debugger.clearBreakpointOnLine(3)
    })

    test('Basic debugging operations via terminal', async () => {
        const editor = await vs.openEditor('hScript2.m')
        await vs.terminal.executeCommand('dbstop in hScript2 at 1')
        await vs.terminal.executeCommand('dbstop in hScript2 at 3')
        await editor.type(Key.F5, 'F5 to run file');
        await editor.debugger.assertStoppedAtLine(1)
        await vs.terminal.assertContains('K>>', 'terminal should have K prompt')
        await vs.terminal.executeCommand('dbcont')
        await editor.debugger.assertStoppedAtLine(3)
        await vs.terminal.executeCommand('dbstep')
        await editor.debugger.assertStoppedAtLine(4)
        await vs.terminal.executeCommand('dbquit')
        await editor.debugger.assertNotDebugging()
    })

    test('Executing commands while debugging', async () => {
        const editor = await vs.openEditor('hScript3.m')
        await editor.type(Key.F5, 'F5 to run file');
        await editor.debugger.assertStoppedAtLine(2) // hScript3.m has keyboard on line 2
        await vs.terminal.executeCommand('12+17')
        await vs.terminal.assertContains('29', 'output should appear in terminal')
        await editor.type(Key.chord(Key.SHIFT, Key.F5), 'Shift+F5 to stop');
        await editor.debugger.assertNotDebugging()
    })

    test('Test pause and resume while debugging', async () => {
        const editor = await vs.openEditor('hScript3.m')
        await editor.type(Key.F5, 'F5 to run file');
        await editor.debugger.assertStoppedAtLine(2) // Ensure we are stopped in a debug session
        await editor.type(Key.F5, 'F5 to resume')
        await editor.debugger.assertNotDebugging()
        await vs.pause(2000) // Allow execution for a few seconds
        await editor.type(Key.F6, 'F6 to pause')
        await editor.debugger.assertDebugging()
        await editor.type(Key.F5, 'F5 to resume')
        await editor.debugger.assertNotDebugging()
    })
});
