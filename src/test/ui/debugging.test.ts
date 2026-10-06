// Copyright 2025 The MathWorks, Inc.
import { Key } from 'vscode-extension-tester';
import { VSCodeTester } from '../tools/tester/VSCodeTester'
import { EditorTester } from '../tools/tester/EditorTester'
import { before, beforeEach, afterEach, after } from 'mocha';

suite('Debugging UI Tests', () => {
    let vs: VSCodeTester
    let editor: EditorTester

    before(async () => {
        vs = new VSCodeTester();
        await vs.openEditor('hScript1.m')
        await vs.assertMATLABConnected()
        await vs.openMATLABTerminal()
        await vs.terminal.assertContains('>>', 'wait for ready prompt')
        await vs.closeActiveEditor()
    });

    beforeEach(async () => {
        // Add the path before every test (and retry): on CI the test-files folder has been seen dropping off the MATLAB path after the first test
        await vs.terminal.executeCommand(`addpath('${vs.getTestFilesDirectory()}'); clc`)
    });

    afterEach(async () => {
        await editor.debugger.stopDebugSession()
        await vs.terminal.executeCommand('dbclear all, clc')
        await vs.closeActiveEditor()
    });

    after(async () => {
        await vs.disconnectFromMATLAB()
    });

    test('Basic debugging operations', async () => {
        editor = await vs.openEditor('hScript2.m')
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
        editor = await vs.openEditor('hScript2.m')
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
        editor = await vs.openEditor('hScript3.m')
        await editor.type(Key.F5, 'F5 to run file');
        await editor.debugger.assertStoppedAtLine(2) // hScript3.m has keyboard on line 2
        await vs.terminal.executeCommand('12+17')
        await vs.terminal.assertContains('29', 'output should appear in terminal')
        await editor.type(Key.chord(Key.SHIFT, Key.F5), 'Shift+F5 to stop');
        await editor.debugger.assertNotDebugging()
    })

    test('Test pause and resume while debugging', async () => {
        editor = await vs.openEditor('hScript3.m')
        await editor.type(Key.F5, 'F5 to run file');
        await editor.debugger.assertStoppedAtLine(2) // Ensure we are stopped in a debug session
        await editor.type(Key.F5, 'F5 to resume')
        await editor.debugger.assertNotDebugging()
        await vs.pause(500) // Allow execution briefly; hScript3.m finishes after ~5s, so F6 must come before then
        await editor.type(Key.F6, 'F6 to pause')
        await editor.debugger.assertDebugging()
        await editor.type(Key.F5, 'F5 to resume')
        await editor.debugger.assertNotDebugging()
    })

    test('WSB display and updates while debugging', async function (this: Mocha.Context) {
        editor = await vs.openEditor('hScript2.m')
        if (await vs.isMatlabVersionLessThan('R2023a')) {
            this.skip()
        }

        await editor.debugger.setBreakpointOnLine(5)
        await editor.type(Key.F5, 'F5 to run file')

        await editor.debugger.assertStoppedAtLine(5)
        // Starting a debug session switches the sidebar to Run and Debug, so open the WSB after
        await vs.openWorkspaceBrowser()
        await editor.type(Key.F10, 'F10 to step over')
        await vs.workspaceBrowser.assertVariableExists('e', 'e should appear in workspace')
        await vs.workspaceBrowser.assertVariableValue('e', '5', 'value should be 5')

        await editor.debugger.assertStoppedAtLine(6)
        await editor.type(Key.F10, 'F10 to step over')
        await vs.workspaceBrowser.assertVariableExists('e', 'e should appear in workspace')
        await vs.workspaceBrowser.assertVariableValue('e', '6', 'value should be updated to 6')

        await editor.type(Key.F5, 'F5 to continue')
        await editor.debugger.assertNotDebugging()
    })
});
