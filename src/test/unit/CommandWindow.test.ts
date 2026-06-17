// Copyright 2026 The MathWorks, Inc.

/* eslint-disable import/first, @typescript-eslint/no-empty-function, @typescript-eslint/no-explicit-any */

// Register vscode mock BEFORE any imports that depend on it
import { registerMockVscode } from './mock-vscode';
registerMockVscode();

import * as assert from 'assert';
import { suite, test, setup } from 'mocha';
import CommandWindow from '../../commandwindow/CommandWindow';
import { MVM, MatlabMVMConnectionState } from '../../commandwindow/MVM';
import { PromptState } from '../../commandwindow/MVMInterface';

/**
 * Creates a CommandWindow with minimal mocks, initialized to READY state.
 */
function createTestCommandWindow (): CommandWindow {
    const mockNotifier = {
        onNotification: () => ({ dispose: () => {} }),
        sendNotification: () => {}
    };

    // Capture event listeners so we can fire promptChange
    const eventListeners: Record<string, (...args: any[]) => void> = {};
    const mockMvm = Object.create(MVM.prototype);
    mockMvm.on = (event: string, handler: (...args: any[]) => void) => {
        eventListeners[event] = handler;
        return { dispose: () => {} };
    };
    mockMvm.getMatlabState = () => MatlabMVMConnectionState.CONNECTED;
    mockMvm.emit = () => {};

    const cw = new CommandWindow(mockMvm, mockNotifier as any);
    cw.open({ rows: 30, columns: 100 });

    // Simulate MATLAB becoming ready — sets prompt to '>> ' and state to READY
    if (eventListeners.promptChange !== undefined) {
        eventListeners.promptChange(PromptState.READY, true);
    }

    return cw;
}

/**
 * Gets the current editable text (part after prompt).
 */
function getEditableText (cw: any): string {
    return cw._currentPromptLine.substring(cw._currentPrompt.length);
}

/**
 * Gets the cursor position within the editable text.
 */
function getCursorIndex (cw: any): number {
    return cw._lastKnownCursorIndex;
}

/**
 * Gets the selection anchor index, if any.
 */
function getAnchorIndex (cw: any): number | undefined {
    return cw._lastKnownAnchorIndex;
}

const ESC = '\x1b';
const KEYS = {
    CTRL_LEFT: ESC + '[1;5D',
    CTRL_RIGHT: ESC + '[1;5C',
    CTRL_SHIFT_LEFT: ESC + '[1;6D',
    CTRL_SHIFT_RIGHT: ESC + '[1;6C',
    CTRL_BACKSPACE: '\x17',
    CTRL_DELETE: ESC + 'd',
    LEFT: ESC + '[D',
    RIGHT: ESC + '[C',
    HOME: ESC + '[H'
};

suite('CommandWindow Escape (clear line)', () => {
    let cw: CommandWindow;

    setup(() => {
        cw = createTestCommandWindow();
    });

    test('Escape clears the current input line', () => {
        cw.handleInput('some typed text');
        cw.handleInput('\x1b');
        assert.strictEqual(getEditableText(cw), '');
        assert.strictEqual(getCursorIndex(cw), 0);
    });

    test('Escape clears line and removes selection', () => {
        cw.handleInput('hello world');
        cw.handleInput(KEYS.CTRL_SHIFT_LEFT); // select 'world'
        cw.handleInput('\x1b');
        assert.strictEqual(getEditableText(cw), '');
        assert.strictEqual(getAnchorIndex(cw), undefined);
    });
});

suite('CommandWindow Word Navigation', () => {
    let cw: CommandWindow;

    setup(() => {
        cw = createTestCommandWindow();
    });

    suite('Ctrl+Left (word left)', () => {
        test('jumps to start of previous word', () => {
            cw.handleInput('hello world');
            cw.handleInput(KEYS.CTRL_LEFT);
            assert.strictEqual(getCursorIndex(cw), 6);
        });

        test('jumps over multiple words', () => {
            cw.handleInput('one two three');
            cw.handleInput(KEYS.CTRL_LEFT);
            assert.strictEqual(getCursorIndex(cw), 8);
            cw.handleInput(KEYS.CTRL_LEFT);
            assert.strictEqual(getCursorIndex(cw), 4);
            cw.handleInput(KEYS.CTRL_LEFT);
            assert.strictEqual(getCursorIndex(cw), 0);
        });

        test('does nothing at start of line', () => {
            cw.handleInput('hello');
            cw.handleInput(KEYS.HOME);
            cw.handleInput(KEYS.CTRL_LEFT);
            assert.strictEqual(getCursorIndex(cw), 0);
        });

        test('stops at punctuation boundary', () => {
            cw.handleInput('foo + bar');
            cw.handleInput(KEYS.CTRL_LEFT);
            assert.strictEqual(getCursorIndex(cw), 6);
            cw.handleInput(KEYS.CTRL_LEFT);
            assert.strictEqual(getCursorIndex(cw), 4);
            cw.handleInput(KEYS.CTRL_LEFT);
            assert.strictEqual(getCursorIndex(cw), 0);
        });

        test('handles single word', () => {
            cw.handleInput('hello');
            cw.handleInput(KEYS.CTRL_LEFT);
            assert.strictEqual(getCursorIndex(cw), 0);
        });

        test('handles only whitespace', () => {
            cw.handleInput('   ');
            cw.handleInput(KEYS.CTRL_LEFT);
            assert.strictEqual(getCursorIndex(cw), 0);
        });

        test('handles only punctuation', () => {
            cw.handleInput('+++');
            cw.handleInput(KEYS.CTRL_LEFT);
            assert.strictEqual(getCursorIndex(cw), 0);
        });
    });

    suite('Ctrl+Right (word right)', () => {
        test('jumps to start of next word', () => {
            cw.handleInput('hello world');
            cw.handleInput(KEYS.HOME);
            cw.handleInput(KEYS.CTRL_RIGHT);
            assert.strictEqual(getCursorIndex(cw), 6);
        });

        test('jumps over multiple words', () => {
            cw.handleInput('one two three');
            cw.handleInput(KEYS.HOME);
            cw.handleInput(KEYS.CTRL_RIGHT);
            assert.strictEqual(getCursorIndex(cw), 4);
            cw.handleInput(KEYS.CTRL_RIGHT);
            assert.strictEqual(getCursorIndex(cw), 8);
            cw.handleInput(KEYS.CTRL_RIGHT);
            assert.strictEqual(getCursorIndex(cw), 13);
        });

        test('does nothing at end of line', () => {
            cw.handleInput('hello');
            cw.handleInput(KEYS.CTRL_RIGHT);
            assert.strictEqual(getCursorIndex(cw), 5);
        });

        test('jumps from mid-word to end of word then past whitespace', () => {
            cw.handleInput('hello world');
            // Move cursor to index 2 (inside 'hello')
            cw.handleInput(KEYS.HOME);
            cw.handleInput(KEYS.RIGHT);
            cw.handleInput(KEYS.RIGHT);
            cw.handleInput(KEYS.CTRL_RIGHT);
            // Should skip remaining word chars ('llo') then non-word (' ') = index 6
            assert.strictEqual(getCursorIndex(cw), 6);
        });

        test('handles only whitespace', () => {
            cw.handleInput('   ');
            cw.handleInput(KEYS.HOME);
            cw.handleInput(KEYS.CTRL_RIGHT);
            assert.strictEqual(getCursorIndex(cw), 3);
        });

        test('handles only punctuation', () => {
            cw.handleInput('+++');
            cw.handleInput(KEYS.HOME);
            cw.handleInput(KEYS.CTRL_RIGHT);
            assert.strictEqual(getCursorIndex(cw), 3);
        });
    });

    suite('Ctrl+Shift+Left (word select left)', () => {
        test('selects previous word', () => {
            cw.handleInput('hello world');
            cw.handleInput(KEYS.CTRL_SHIFT_LEFT);
            assert.strictEqual(getCursorIndex(cw), 6);
            assert.strictEqual(getAnchorIndex(cw), 11);
        });

        test('extends selection over multiple words', () => {
            cw.handleInput('one two three');
            cw.handleInput(KEYS.CTRL_SHIFT_LEFT);
            cw.handleInput(KEYS.CTRL_SHIFT_LEFT);
            assert.strictEqual(getCursorIndex(cw), 4);
            assert.strictEqual(getAnchorIndex(cw), 13);
        });
    });

    suite('Ctrl+Shift+Right (word select right)', () => {
        test('selects next word', () => {
            cw.handleInput('hello world');
            cw.handleInput(KEYS.HOME);
            cw.handleInput(KEYS.CTRL_SHIFT_RIGHT);
            assert.strictEqual(getCursorIndex(cw), 6);
            assert.strictEqual(getAnchorIndex(cw), 0);
        });
    });

    suite('Ctrl+Backspace (delete word left)', () => {
        test('deletes previous word from end', () => {
            cw.handleInput('hello world');
            cw.handleInput(KEYS.CTRL_BACKSPACE);
            assert.strictEqual(getEditableText(cw), 'hello ');
            assert.strictEqual(getCursorIndex(cw), 6);
        });

        test('deletes word and trailing space', () => {
            cw.handleInput('one two three');
            cw.handleInput(KEYS.CTRL_BACKSPACE);
            assert.strictEqual(getEditableText(cw), 'one two ');
        });

        test('deletes from middle of line', () => {
            cw.handleInput('hello world');
            cw.handleInput(KEYS.LEFT);
            cw.handleInput(KEYS.LEFT);
            cw.handleInput(KEYS.CTRL_BACKSPACE);
            assert.strictEqual(getEditableText(cw), 'hello ld');
        });

        test('does nothing at start of line', () => {
            cw.handleInput('hello');
            cw.handleInput(KEYS.HOME);
            cw.handleInput(KEYS.CTRL_BACKSPACE);
            assert.strictEqual(getEditableText(cw), 'hello');
            assert.strictEqual(getCursorIndex(cw), 0);
        });

        test('deletes entire single word', () => {
            cw.handleInput('hello');
            cw.handleInput(KEYS.CTRL_BACKSPACE);
            assert.strictEqual(getEditableText(cw), '');
            assert.strictEqual(getCursorIndex(cw), 0);
        });

        test('handles consecutive spaces', () => {
            cw.handleInput('hello  world');
            cw.handleInput(KEYS.CTRL_BACKSPACE);
            assert.strictEqual(getEditableText(cw), 'hello  ');
        });

        test('removes selection instead of word when selection is active', () => {
            cw.handleInput('hello world');
            cw.handleInput(KEYS.CTRL_SHIFT_LEFT); // select 'world'
            cw.handleInput(KEYS.CTRL_BACKSPACE);
            assert.strictEqual(getEditableText(cw), 'hello ');
            assert.strictEqual(getAnchorIndex(cw), undefined);
        });
    });

    suite('Ctrl+Delete (delete word right)', () => {
        test('deletes next word from start', () => {
            cw.handleInput('hello world');
            cw.handleInput(KEYS.HOME);
            cw.handleInput(KEYS.CTRL_DELETE);
            assert.strictEqual(getEditableText(cw), 'world');
            assert.strictEqual(getCursorIndex(cw), 0);
        });

        test('deletes word from middle', () => {
            cw.handleInput('one two three');
            cw.handleInput(KEYS.HOME);
            cw.handleInput(KEYS.CTRL_RIGHT); // move past 'one '
            cw.handleInput(KEYS.CTRL_DELETE);
            assert.strictEqual(getEditableText(cw), 'one three');
            assert.strictEqual(getCursorIndex(cw), 4);
        });

        test('does nothing at end of line', () => {
            cw.handleInput('hello');
            cw.handleInput(KEYS.CTRL_DELETE);
            assert.strictEqual(getEditableText(cw), 'hello');
        });

        test('deletes entire single word from start', () => {
            cw.handleInput('hello');
            cw.handleInput(KEYS.HOME);
            cw.handleInput(KEYS.CTRL_DELETE);
            assert.strictEqual(getEditableText(cw), '');
        });

        test('removes selection instead of word when selection is active', () => {
            cw.handleInput('hello world');
            cw.handleInput(KEYS.HOME);
            cw.handleInput(KEYS.CTRL_SHIFT_RIGHT); // select 'hello '
            cw.handleInput(KEYS.CTRL_DELETE);
            assert.strictEqual(getEditableText(cw), 'world');
            assert.strictEqual(getAnchorIndex(cw), undefined);
        });
    });
});
