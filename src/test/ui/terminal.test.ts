// Copyright 2025 The MathWorks, Inc.
import { VSCodeTester } from '../tools/tester/VSCodeTester'
import { before, afterEach, after } from 'mocha';
import { Key } from 'selenium-webdriver';

suite('Terminal UI Tests', () => {
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

    test('Test command history up/down', async () => {
        await vs.terminal.executeCommand('a = 123;')
        await vs.terminal.executeCommand('b = 456;')
        await vs.terminal.executeCommand('clc')
        await vs.terminal.type(Key.ARROW_UP)
        await vs.terminal.type(Key.ARROW_UP)
        await vs.terminal.assertContains('b = 456;', 'Up arrow should recall previous command')
        await vs.terminal.type(Key.ARROW_UP)
        await vs.terminal.assertContains('a = 123;', 'Second up arrow should recall earlier command')
        await vs.terminal.type(Key.ARROW_DOWN)
        await vs.terminal.assertContains('b = 456;', 'Down arrow should go forward in history')
        await vs.terminal.type(Key.ESCAPE)
    })

    test('Test command history prefix filtering', async () => {
        // Enter command that will be in history
        await vs.terminal.executeCommand('a = 123;')
        await vs.terminal.executeCommand('clc')

        // Type 'a' and then up arrow should recall 'a = 123;'
        await vs.terminal.type('a')
        await vs.terminal.type(Key.ARROW_UP)
        await vs.terminal.assertContains('a = 123;', 'Up arrow after typing "a" should recall matching command')
        await vs.terminal.type(Key.ESCAPE)
    });

    test('Test multi-line command history cycling', async () => {
        // Execute a multi-line command by pasting (simulates copy-paste of multi-line text)
        await vs.terminal.type('x = [1 2\n     3 4]')
        await vs.terminal.type(Key.RETURN)

        // Execute another command to move forward in history
        await vs.terminal.executeCommand('y = 5;')
        await vs.terminal.executeCommand('clc')

        // Recall the multi-line command with up arrow
        await vs.terminal.type(Key.ARROW_UP)
        await vs.terminal.type(Key.ARROW_UP)
        await vs.terminal.assertContains('x = [1 2', 'Up arrow should recall first line of multi-line command')
        await vs.terminal.assertContains('3 4]', 'Up arrow should recall second line of multi-line command')

        // Cycle away from the multi-line command
        await vs.terminal.type(Key.ARROW_DOWN)
        await vs.terminal.assertNotContains('x = [1 2', 'First line should not stick after cycling away with down arrow')
        await vs.terminal.assertNotContains('3 4]', 'Second line should not stick after cycling away with down arrow')
        await vs.terminal.type(Key.ESCAPE)
    });
});
