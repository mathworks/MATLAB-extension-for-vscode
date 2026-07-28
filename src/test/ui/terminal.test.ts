// Copyright 2025 The MathWorks, Inc.
import { VSCodeTester } from '../tools/tester/VSCodeTester'
import { before, afterEach, after } from 'mocha';
import { Key } from 'selenium-webdriver';

suite('Terminal UI Tests', () => {
    let vs: VSCodeTester
    let skipWarningColorTests: boolean

    before(async () => {
        vs = new VSCodeTester();
        await vs.openEditor('hScript1.m')
        await vs.assertMATLABConnected()
        await vs.openMATLABTerminal()
        await vs.closeActiveEditor()
        skipWarningColorTests = await vs.isMatlabVersionLessThan('R2025b')
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
    })

    test('Test wrapping for wide outputs', async () => {
        await vs.terminal.executeCommand('ones(1, 100)') // wide enough to wrap
        await vs.terminal.assertContains('Columns', 'output should be wrapped')
    })

    test('Test no wrapping for smaller outputs', async () => {
        await vs.terminal.executeCommand('ones(1, 6)') // not wide enough to wrap
        await vs.terminal.assertContains('1     1     1     1     1     1', 'output should not be wrapped')
    })

    test('Test warning text appears yellow', async function () {
        if (skipWarningColorTests) {
            this.skip()
        }
        await vs.terminal.executeCommand("warning('test warning message')")
        await vs.terminal.assertTextIsYellow('test warning message', 'warning output should be yellow')
    })

    test('Test normal output is white', async function () {
        if (skipWarningColorTests) {
            this.skip()
        }
        await vs.terminal.executeCommand("disp('normal text')")
        await vs.terminal.assertTextIsWhite('normal text', 'normal output should be default color')
    })

    test('Test color resets after warning', async function () {
        if (skipWarningColorTests) {
            this.skip()
        }
        await vs.terminal.executeCommand("warning('yellow text')")
        await vs.terminal.executeCommand("disp('after warning')")
        await vs.terminal.assertTextIsYellow('yellow text', 'warning should be yellow')
        await vs.terminal.assertTextIsWhite('after warning', 'text after warning should be default color')
    })

    test('Test syntax highlighting colors typed text', async () => {
        await vs.terminal.type("x = 'hello'")
        await vs.terminal.assertTextHasColor('hello', 'typed text should have syntax coloring')
        await vs.terminal.type(Key.ESCAPE)
    })

    test('Test selected text is uncolored', async () => {
        await vs.terminal.type("x = 'hello'")
        await vs.terminal.assertTextHasColor('hello', 'typed text should have syntax coloring before selection')
        await vs.terminal.type(Key.chord(Key.SHIFT, Key.HOME))
        await vs.terminal.assertTextHasUniformColor('hello', 'selected text should have uniform color, not syntax highlighting')
        await vs.terminal.type(Key.ESCAPE)
    })

    test('Test prompt string from input command', async () => {
        await vs.terminal.executeCommand('prompt = "Input a color :";')
        await vs.terminal.executeCommand('clc')
        await vs.terminal.executeCommand('input(prompt, "s");')
        await vs.terminal.assertContains('Input a color :', 'Prompt string from input command should be displayed')
        // Exit input prompt
        await vs.terminal.executeCommand('red')
    })
});
