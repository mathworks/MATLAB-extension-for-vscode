// Copyright 2025 The MathWorks, Inc.
import { VSCodeTester } from '../tools/tester/VSCodeTester'
import { before, afterEach, after } from 'mocha';
import { Key } from 'selenium-webdriver';

suite('Terminal Smoke Tests', () => {
    let vs: VSCodeTester

    before(async () => {
        vs = new VSCodeTester();
        await vs.openEditor('hScript1.m')
        await vs.assertMATLABConnected()
        await vs.closeActiveEditor()
        await vs.openMATLABTerminal()
    });

    afterEach(async () => {
        await vs.terminal.executeCommand('clc')
    });

    after(async () => {
        await vs.disconnectFromMATLAB()
    });

    test('Test prompt', async () => {
        await vs.terminal.assertContent('>>', 'expect terminal to have ready prompt')
    })

    test('Test simple execution', async () => {
        await vs.terminal.executeCommand('1+1');
        await vs.terminal.assertContains('2', 'output should appear in terminal')
    })

    test('Test clc', async () => {
        await vs.terminal.executeCommand('magic(10)')
        await vs.terminal.executeCommand('clc');
        await vs.terminal.assertContent('>>', 'clc should clear terminal')
    })

    test('Test tab completions', async () => {
        await vs.terminal.type('displ')
        await vs.terminal.type(Key.TAB)
        await vs.terminal.assertContains('display', 'terminal should contain display')
        await vs.terminal.type(Key.ESCAPE)
        await vs.terminal.assertContent('>>', 'ESCAPE should clear typed command and suggestion')
    })

    test('Test tab completions with context', async () => {
        await vs.terminal.executeCommand('xVar = 1;')
        await vs.terminal.type('disp(x')
        await vs.terminal.type(Key.TAB)
        await vs.terminal.assertContains('disp(xVar', 'terminal should contain disp(xVar')
        await vs.terminal.type(Key.ESCAPE)
    })

    test('Test tab completions from within the command', async () => {
        await vs.terminal.executeCommand('xVar = 1;')
        await vs.terminal.type('x + 3')
        await vs.terminal.type(Key.LEFT)
        await vs.terminal.type(Key.LEFT)
        await vs.terminal.type(Key.LEFT)
        await vs.terminal.type(Key.LEFT)
        await vs.terminal.type(Key.TAB)
        await vs.terminal.assertContains('xVar + 3', 'terminal should contain xVar + 3')
        await vs.terminal.type(Key.ESCAPE)
    })
});
