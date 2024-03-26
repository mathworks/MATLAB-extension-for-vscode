// Copyright 2024 The MathWorks, Inc.
import { VSCodeTester } from '../tools/tester/VSCodeTester'
import { before, afterEach } from 'mocha';

suite('Terminal Smoke Tests', () => {
    let vs: VSCodeTester

    before(async () => {
        vs = new VSCodeTester();
        await vs.openDocument('hScript1.m')
        await vs.assertMATLABConnected()
        await vs.closeActiveDocument()
        await vs.openMATLABTerminal()
    });

    afterEach(async () => {
        await vs.terminal.executeCommand('clc');
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
});
