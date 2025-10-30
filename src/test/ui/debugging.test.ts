// Copyright 2025 The MathWorks, Inc.
import { VSCodeTester } from '../tools/tester/VSCodeTester'
import { before, afterEach, after } from 'mocha';

suite('Debugging UI Tests', () => {
    let vs: VSCodeTester

    before(async () => {
        vs = new VSCodeTester();
        await vs.openEditor('hScript1.m')
        await vs.assertMATLABConnected()
        await vs.closeActiveEditor()
        await vs.openMATLABTerminal()
        await vs.terminal.executeCommand(`addpath('${vs.getTestFilesDirectory()}')`)
        await vs.terminal.executeCommand('clc')
    });

    afterEach(async () => {
        await vs.terminal.executeCommand('dbclear all, clc')
        await vs.closeActiveEditor()
    });

    after(async () => {
        await vs.disconnectFromMATLAB()
    });

    test('Basic debugging operations', async () => {
        await vs.openEditor('hScript2.m')
        return; // Temporarily disable this test due to flakiness on CI
        await vs.setSetting('debug.toolBarLocation', 'floating');
        const editor = await vs.openEditor('hScript2.m')
        await editor.toggleBreakpoint(1)
        await editor.toggleBreakpoint(3)
        await vs.runCurrentFile()
        await vs.debugger.waitForToolbar()
        await vs.debugger.assertStoppedAtLine(1)
        await vs.debugger.toolbar.continue()
        await vs.debugger.assertStoppedAtLine(3)
        await vs.debugger.toolbar.stepOver()
        await vs.debugger.assertStoppedAtLine(4)
        await vs.debugger.toolbar.stop()
        await vs.debugger.assertNotDebugging()
        await editor.toggleBreakpoint(1)
        await editor.toggleBreakpoint(3)
        await vs.setSetting('debug.toolBarLocation', 'docked');
    })

    test('Basic debugging operations via terminal', async () => {
        await vs.openEditor('hScript2.m')
        await vs.terminal.executeCommand('dbstop in hScript2 at 1')
        await vs.terminal.executeCommand('dbstop in hScript2 at 3')
        await vs.runCurrentFile()
        await vs.debugger.assertStoppedAtLine(1)
        await vs.terminal.assertContains('K>>', 'terminal should have K prompt')
        await vs.terminal.executeCommand('dbcont')
        await vs.debugger.assertStoppedAtLine(3)
        await vs.terminal.executeCommand('dbstep')
        await vs.debugger.assertStoppedAtLine(4)
        await vs.terminal.executeCommand('dbquit')
        await vs.debugger.assertNotDebugging()
    })

    test('Executing commands while debugging', async () => {
        const editor = await vs.openEditor('hScript2.m')
        await editor.toggleBreakpoint(1)
        await vs.runCurrentFile()
        await vs.debugger.assertStoppedAtLine(1)
        await vs.terminal.executeCommand('12+17')
        await vs.terminal.assertContains('29', 'output should appear in terminal')
        await vs.terminal.executeCommand('dbquit')
        await vs.debugger.assertNotDebugging()
        await editor.toggleBreakpoint(1)
    })
});
