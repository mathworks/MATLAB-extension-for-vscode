// Copyright 2024 The MathWorks, Inc.

import * as vscode from 'vscode'
import MVM, { MatlabState } from './MVM'
import { TextEvent } from './MVMInterface'

/**
 * Direction of cursor movement
 */
enum CursorDirection {
    LEFT,
    RIGHT
}

/**
 * Direction of history movement
 */
enum HistoryDirection {
    BACKWARDS,
    FORWARDS
}

/**
 * Indicator of whether the selection anchor should be kept in place or moved
 */
enum AnchorPolicy {
    MOVE,
    KEEP
}

const ESC = '\x1b';

/**
 * Various terminal escape sequences
 */
const ACTION_KEYS = {
    LEFT: ESC + '[D',
    RIGHT: ESC + '[C',
    UP: ESC + '[A',
    DOWN: ESC + '[B',
    SHIFT_LEFT: ESC + '[1;2D',
    SHIFT_RIGHT: ESC + '[1;2C',
    HOME: ESC + '[H',
    END: ESC + '[F',
    SHIFT_HOME: ESC + '[1;2H',
    SHIFT_END: ESC + '[1;2F',
    NEWLINE: '\r\n',
    BACKSPACE: '\x7f',
    BACKSPACE_ALTERNATIVE: '\b',
    SELECT_ALL: '\x01',
    DELETE: ESC + '[3~',
    ESCAPE: ESC,

    INVERT_COLORS: ESC + '[7m',
    RESTORE_COLORS: ESC + '[27m',
    RED_FOREGROUND: ESC + '[31m',
    ALL_DEFAULT_COLORS: ESC + '[0m',

    COPY: '\x03',
    PASTE: '\x16',

    MOVE_TO_POSITION_IN_LINE: (n: number) => ESC + '[' + n.toString() + 'G',
    CLEAR_AND_MOVE_TO_BEGINNING: ESC + '[0G' + ESC + '[0J',
    CLEAR_COMPLETELY: ESC + '[2J' + ESC + '[1;1H',

    QUERY_CURSOR: ESC + '[6n',
    SET_CURSOR_STYLE_TO_BAR: ESC + '[5 q'
};

const PROMPTS = {
    IDLE_PROMPT: '>> '
};

/**
 * Represents command window. Is a pseudoterminal to be used as the input/output processor in a VS Code terminal.
 */
export default class CommandWindow implements vscode.Pseudoterminal {
    private readonly _mvm: MVM;
    private readonly _writeEmitter: vscode.EventEmitter<string>;

    private _initialized: boolean = false;
    private _isBusy: boolean = false;
    private readonly _currentPrompt = PROMPTS.IDLE_PROMPT;

    private _currentLine: string = this._currentPrompt;
    private _cursorIndex: number = 0;
    private _anchorIndex?: number = undefined;

    private readonly _commandHistory: string[] = [];
    private _historyIndex: number = 0;
    private _lastKnownCurrentLine: string = '';

    private _isLineDirty: boolean = false;

    private _terminalDimensions: vscode.TerminalDimensions;
    private _lastSentTerminalDimensions: vscode.TerminalDimensions | null = null;

    private readonly _inputQueue: string[] = [];

    private _justTypedLastInRow: boolean = false;

    constructor (mvm: MVM) {
        this._mvm = mvm;
        this._mvm.onOutput = this.addOutput.bind(this);
        this._mvm.onClc = this.clear.bind(this);

        this._initialized = false;

        this._writeEmitter = new vscode.EventEmitter<string>();
        this.onDidWrite = this._writeEmitter.event;
        this._terminalDimensions = { rows: 30, columns: 100 };

        this._mvm.addStateChangeListener(this._handleMatlabStateChange.bind(this));

        this._updateHasSelectionContext();
    }

    /**
     * Called when a terminal with this pseudoterminal is opened.
     *
     * Depending on MATLAB state we will either clear the terminal or write the current line again.
     * @param initialDimensions
     */
    open (initialDimensions?: vscode.TerminalDimensions): void {
        if (initialDimensions != null) {
            this._terminalDimensions = initialDimensions;
        }

        this._writeEmitter.fire(ACTION_KEYS.SET_CURSOR_STYLE_TO_BAR);

        const currentMatlabState = this._mvm.getMatlabState();
        if (currentMatlabState === MatlabState.READY) {
            this._isBusy = false;
            this._initialized = true;
            this._writeCurrentLine();
        } else if (currentMatlabState === MatlabState.DISCONNECTED) {
            this._clearState();
            this._isBusy = false;
            this._initialized = false;
        } else if (currentMatlabState === MatlabState.BUSY) {
            this._clearState();
            this._isBusy = true;
            this._initialized = true;
        }
    }

    close (): void {
        // Unimplemented
    }

    /**
     * Resets the terminal state
     */
    private _clearState (): void {
        this._writeEmitter.fire(ACTION_KEYS.CLEAR_COMPLETELY)
        this._setToEmptyPrompt();
        this._lastSentTerminalDimensions = null;
    }

    private _handleMatlabStateChange (oldState: MatlabState, newState: MatlabState): void {
        if (oldState === newState) {
            return;
        }

        if (newState === MatlabState.READY) {
            this._clearState();
            this._isBusy = false;
            this._initialized = true;
            this._writeCurrentLine();
        } else if (newState === MatlabState.DISCONNECTED) {
            this._clearState();
            this._isBusy = false;
            this._initialized = false;
        } else if (newState === MatlabState.BUSY) {
            this._clearState();
            this._isBusy = true;
            this._initialized = true;
        }
    }

    /**
     * Clear current line and selection
     */
    private _setToEmptyPrompt (): void {
        this._currentLine = this._currentPrompt;
        this._lastKnownCurrentLine = this._currentLine;
        this._cursorIndex = 0;
        this._anchorIndex = undefined;
        this._updateHasSelectionContext();
    }

    /**
     * Insert a command to run and submit it.
     * @param command
     */
    insertCommandForEval (command: string): void {
        if (this._currentLine !== this._currentPrompt) {
            this._setToEmptyPrompt();
            this._writeCurrentLine();
        }
        // TODO: handle partially enter commands when run is hit
        this.handleInput(command + ACTION_KEYS.NEWLINE);
    }

    /**
     * Handles input data from the user. Adds it to a queue to be processed asynchronously when we are next idle.
     * @param data
     * @returns
     */
    handleInput (data: string): void {
        if (!this._initialized) {
            return;
        }

        this._inputQueue.push(data);
        this._processQueueUntilBusy();
    }

    private _processQueueItem (): void {
        const nextItem = this._inputQueue.shift();
        if (nextItem === undefined) {
            return;
        }
        this.handleText(nextItem, false);
    }

    private _processQueueUntilBusy (): void {
        while (this._inputQueue.length > 0 && !this._isBusy) {
            this._processQueueItem();
        }
    }

    /**
     * Processes the incoming text, handling the terminal escape sequences as needed.
     * @param data
     * @param isOutput
     * @returns
     */
    handleText (data: string, isOutput: boolean): void {
        if (data.startsWith(ESC)) {
            /* eslint-disable-next-line no-control-regex */
            const match = data.match(/^\x1b\[(?<row>[0-9]+);(?<col>[0-9]+)R$/)
            if (match !== null && 'groups' in match && (match.groups != null) && 'row' in match.groups && 'col' in match.groups) {
                return;
            }

            switch (data) {
                case ACTION_KEYS.LEFT:
                    this._handleLeftRight(CursorDirection.LEFT, AnchorPolicy.MOVE);
                    break;
                case ACTION_KEYS.RIGHT:
                    this._handleLeftRight(CursorDirection.RIGHT, AnchorPolicy.MOVE);
                    break;
                case ACTION_KEYS.SHIFT_LEFT:
                    this._handleLeftRight(CursorDirection.LEFT, AnchorPolicy.KEEP);
                    break;
                case ACTION_KEYS.SHIFT_RIGHT:
                    this._handleLeftRight(CursorDirection.RIGHT, AnchorPolicy.KEEP);
                    break;
                case ACTION_KEYS.END:
                    this._handleEnd(AnchorPolicy.MOVE);
                    break;
                case ACTION_KEYS.SHIFT_END:
                    this._handleEnd(AnchorPolicy.KEEP);
                    break;
                case ACTION_KEYS.HOME:
                    this._handleHome(AnchorPolicy.MOVE);
                    break;
                case ACTION_KEYS.SHIFT_HOME:
                    this._handleHome(AnchorPolicy.KEEP);
                    break;
                case ACTION_KEYS.DELETE:
                    this._handleDelete();
                    break;
                case ACTION_KEYS.UP:
                    this._handleNavigateHistory(HistoryDirection.BACKWARDS);
                    break;
                case ACTION_KEYS.DOWN:
                    this._handleNavigateHistory(HistoryDirection.FORWARDS);
                    break;
                case ACTION_KEYS.ESCAPE:
                    this._handleEscape();
            }

            if (this._isLineDirty) {
                this._writeCurrentLine();
            }
            return;
        }

        switch (data) {
            case ACTION_KEYS.BACKSPACE:
            case ACTION_KEYS.BACKSPACE_ALTERNATIVE:
                this._handleBackspace();
                return;
            case ACTION_KEYS.SELECT_ALL:
                this._handleSelectAll();
                return;
            case ACTION_KEYS.COPY:
                this._handleCopy();
                return;
            case ACTION_KEYS.PASTE:
                this._handlePaste();
                return;
        }

        if (data.length === 1 && data.charCodeAt(0) < ' '.charCodeAt(0) && data !== '\r' && data !== '\n') {
            return;
        }

        const lines = this._preprocessInputLines(data);

        // Case 1: Normal typing
        if (lines.length === 1) {
            this._handleLine(lines[0]);

        // Case 2: Normal typing followed by an enter.
        } else if (lines.length === 2 && lines[1].length === 0) {
            this._handleLine(lines[0]);
            if (isOutput) {
                this._handleOutputEnter();
            } else {
                this._handleEnter();
            }
        // Case 3: Multi-line input (ie, from pasting, etc)
        } else {
            for (let i = 0; i < lines.length; i++) {
                this._handleLine(lines[i] + (i === lines.length - 1 ? '' : ACTION_KEYS.NEWLINE));
            }
            if (isOutput) {
                this._handleOutputEnter();
            } else {
                this._handleEnter();
            }
        }
    }

    private _preprocessInputLines (data: string): string[] {
        data = data.replace(/\r\n?/g, '\n');
        const lines = data.split('\n');
        return lines;
    }

    private _handleNavigateHistory (direction: HistoryDirection): void {
        const isCurrentlyAtEndOfHistory = this._historyIndex === this._commandHistory.length;
        const isCurrentlyAtBeginningOfHistory = this._historyIndex === 0;

        if (direction === HistoryDirection.BACKWARDS && isCurrentlyAtBeginningOfHistory) {
            return;
        }

        if (direction === HistoryDirection.FORWARDS && isCurrentlyAtEndOfHistory) {
            return;
        }

        if (isCurrentlyAtEndOfHistory) {
            this._lastKnownCurrentLine = this._currentLine;
        }

        this._historyIndex += direction === HistoryDirection.BACKWARDS ? -1 : 1;
        this._replaceCurrentLineWithNewLine(this._getHistoryItem(this._historyIndex))

        this._justTypedLastInRow = this._getAbsoluteIndexOnLine(this._cursorIndex) % this._terminalDimensions.columns === 0;
    }

    private _markCurrentLineChanged (): void {
        this._historyIndex = this._commandHistory.length;
        this._lastKnownCurrentLine = '';
    }

    private _possiblyUpdateAnchor (policy: AnchorPolicy): void {
        if (policy === AnchorPolicy.MOVE && this._anchorIndex !== undefined) {
            this._anchorIndex = undefined;
            this._isLineDirty = true;
        } else if (policy === AnchorPolicy.KEEP) {
            if (this._anchorIndex === undefined) {
                this._anchorIndex = this._cursorIndex;
            }
            this._isLineDirty = true;
        }
        this._updateHasSelectionContext();
    }

    private _handleEnd (anchorPolicy: AnchorPolicy): void {
        const currentCursorLine = Math.ceil(this._getAbsoluteIndexOnLine(this._cursorIndex) / this._terminalDimensions.columns);
        this._possiblyUpdateAnchor(anchorPolicy);
        this._cursorIndex = this._getMaxIndexOnLine();
        this._moveCursorToCurrent(currentCursorLine);
    }

    private _handleHome (anchorPolicy: AnchorPolicy): void {
        const currentCursorLine = Math.ceil(this._getAbsoluteIndexOnLine(this._cursorIndex) / this._terminalDimensions.columns);
        this._possiblyUpdateAnchor(anchorPolicy);
        this._cursorIndex = 0;
        this._moveCursorToCurrent(currentCursorLine);
    }

    private _handleLeftRight (direction: CursorDirection, anchorPolicy: AnchorPolicy): void {
        if (direction === CursorDirection.LEFT && this._cursorIndex !== 0) {
            if (this._justTypedLastInRow) {
                // Don't actually move the cursor, but do move the index we think the cursor is at.
                this._justTypedLastInRow = false;
            } else {
                if (this._getAbsoluteIndexOnLine(this._cursorIndex) % this._terminalDimensions.columns === 0) {
                    this._writeEmitter.fire(ACTION_KEYS.UP + ACTION_KEYS.MOVE_TO_POSITION_IN_LINE(this._terminalDimensions.columns));
                } else {
                    this._writeEmitter.fire(ACTION_KEYS.LEFT);
                }
            }

            this._possiblyUpdateAnchor(anchorPolicy);
            this._cursorIndex--;
        }

        if (direction === CursorDirection.RIGHT && this._cursorIndex !== this._getMaxIndexOnLine()) {
            if (this._justTypedLastInRow) {
                // Not possible
            } else {
                if (this._getAbsoluteIndexOnLine(this._cursorIndex) % this._terminalDimensions.columns === (this._terminalDimensions.columns - 1)) {
                    this._writeEmitter.fire(ACTION_KEYS.DOWN + ACTION_KEYS.MOVE_TO_POSITION_IN_LINE(0));
                } else {
                    this._writeEmitter.fire(ACTION_KEYS.RIGHT);
                }
            }

            this._possiblyUpdateAnchor(anchorPolicy);
            this._cursorIndex++;
        }
    }

    private _getMaxIndexOnLine (): number {
        return this._currentLine.length - this._currentPrompt.length;
    }

    private _getAbsoluteIndexOnLine (index: number): number {
        return index + this._currentPrompt.length;
    }

    private _handleBackspace (): void {
        if (this._anchorIndex !== undefined) {
            this._removeSelection();
            if (this._isLineDirty) {
                this._markCurrentLineChanged();
                this._writeCurrentLine();
            }
            return;
        }

        if (this._cursorIndex === 0) {
            return;
        }

        const before = this._currentLine.substring(0, this._getAbsoluteIndexOnLine(this._cursorIndex) - 1);
        const after = this._currentLine.substring(this._getAbsoluteIndexOnLine(this._cursorIndex));
        this._currentLine = before + after;
        this._cursorIndex--;
        this._markCurrentLineChanged();
        this._writeCurrentLine();
    }

    private _handleSelectAll (): void {
        this._cursorIndex = this._getMaxIndexOnLine();
        this._anchorIndex = 0;
        this._updateHasSelectionContext();
        this._writeCurrentLine();
    }

    private _handleDelete (): void {
        if (this._anchorIndex !== undefined) {
            this._removeSelection();
            if (this._isLineDirty) {
                this._markCurrentLineChanged();
                this._writeCurrentLine();
            }
            return;
        }

        if (this._cursorIndex === this._getMaxIndexOnLine()) {
            return;
        }

        const before = this._currentLine.substring(0, this._getAbsoluteIndexOnLine(this._cursorIndex));
        const after = this._currentLine.substring(this._getAbsoluteIndexOnLine(this._cursorIndex) + 1);
        this._currentLine = before + after;
        this._markCurrentLineChanged();
        this._writeCurrentLine();
    }

    private _writeCurrentLine (): void {
        const numberOfLinesBehind = Math.floor(this._getAbsoluteIndexOnLine(this._cursorIndex) / this._terminalDimensions.columns);
        if (numberOfLinesBehind !== 0) {
            this._writeEmitter.fire(ACTION_KEYS.UP.repeat(numberOfLinesBehind))
        }
        this._writeEmitter.fire(ACTION_KEYS.CLEAR_AND_MOVE_TO_BEGINNING)
        if (this._anchorIndex === undefined) {
            this._writeEmitter.fire(this._currentLine)
        } else {
            const selectionStart = this._currentPrompt.length + Math.min(this._cursorIndex, this._anchorIndex);
            const selectionEnd = this._currentPrompt.length + Math.max(this._cursorIndex, this._anchorIndex);
            const preSelection = this._currentLine.slice(0, selectionStart);
            const selection = this._currentLine.slice(selectionStart, selectionEnd);
            const postSelection = this._currentLine.slice(selectionEnd);
            this._writeEmitter.fire(preSelection);
            this._writeEmitter.fire(ACTION_KEYS.INVERT_COLORS);
            this._writeEmitter.fire(selection);
            this._writeEmitter.fire(ACTION_KEYS.RESTORE_COLORS);
            this._writeEmitter.fire(postSelection);
        }
        const currentCursorLine = Math.ceil(this._currentLine.length / this._terminalDimensions.columns);
        this._moveCursorToCurrent(currentCursorLine);
        this._isLineDirty = false;
    }

    private _replaceCurrentLineWithNewLine (updatedLine: string): void {
        this._currentLine = updatedLine;
        this._cursorIndex = this._getMaxIndexOnLine();
        this._anchorIndex = undefined;
        this._writeCurrentLine();
    }

    private _removeSelection (): void {
        if (this._anchorIndex === undefined || this._cursorIndex === this._anchorIndex) {
            this._anchorIndex = undefined;
            this._updateHasSelectionContext();
            return;
        }
        const selectionStart = this._getAbsoluteIndexOnLine(Math.min(this._cursorIndex, this._anchorIndex));
        const selectionEnd = this._getAbsoluteIndexOnLine(Math.max(this._cursorIndex, this._anchorIndex));
        const preSelection = this._currentLine.slice(0, selectionStart);
        const postSelection = this._currentLine.slice(selectionEnd);
        this._currentLine = preSelection + postSelection;
        this._cursorIndex = selectionStart - this._currentPrompt.length;
        this._anchorIndex = undefined;
        this._isLineDirty = true;
        this._updateHasSelectionContext();
    }

    private _handleLine (line: string): void {
        this._removeSelection();
        if (this._isLineDirty) {
            this._writeCurrentLine();
        }

        if (this._cursorIndex === this._getMaxIndexOnLine()) {
            this._currentLine += line;
            this._cursorIndex += line.length;
            this._writeEmitter.fire(line);
        } else {
            const before = this._currentLine.substring(0, this._getAbsoluteIndexOnLine(this._cursorIndex));
            const after = this._currentLine.substring(this._getAbsoluteIndexOnLine(this._cursorIndex));
            this._currentLine = before + line + after;
            this._cursorIndex += line.length;
            this._isLineDirty = true;
            this._writeCurrentLine();
        }
        this._markCurrentLineChanged();
        this._justTypedLastInRow = this._getAbsoluteIndexOnLine(this._cursorIndex) % this._terminalDimensions.columns === 0;
    }

    private _handleOutputEnter (): void {
        this._handleEnd(AnchorPolicy.MOVE);
        this._writeEmitter.fire(ACTION_KEYS.NEWLINE);
    }

    private _handleEnter (): void {
        const stringToEvaluate = this._currentLine.substring(this._getAbsoluteIndexOnLine(0), this._getAbsoluteIndexOnLine(this._getMaxIndexOnLine())).trim();
        this._addToHistory(this._currentLine);
        this._handleEnd(AnchorPolicy.MOVE);
        this._writeEmitter.fire(ACTION_KEYS.NEWLINE);
        this._setToEmptyPrompt();
        this._isBusy = true;
        this._evaluateCommand(stringToEvaluate).then(() => {
            this._setToEmptyPrompt();
            this._writeCurrentLine();
            this._justTypedLastInRow = this._getAbsoluteIndexOnLine(this._cursorIndex) % this._terminalDimensions.columns === 0;
            this._isBusy = false;
            this._processQueueUntilBusy();
        }, () => {
            // Ignored
        })
    }

    private _addToHistory (command: string): void {
        const isEmpty = command === this._currentPrompt;
        const isLastInHistory = this._commandHistory.length !== 0 && command === this._commandHistory[this._commandHistory.length - 1];
        if (!isEmpty && !isLastInHistory) {
            this._commandHistory.push(command);
        }
        this._historyIndex = this._commandHistory.length;
    }

    private _getHistoryItem (n: number): string {
        if (this._historyIndex < this._commandHistory.length) {
            return this._commandHistory[n];
        } else {
            return this._lastKnownCurrentLine;
        }
    }

    private _moveCursorToCurrent (lineOfInputCursorIsCurrentlyOn?: number): void {
        const lineNumberCursorShouldBeOn = Math.ceil(this._getAbsoluteIndexOnLine(this._cursorIndex) / this._terminalDimensions.columns);
        if (lineOfInputCursorIsCurrentlyOn === undefined) {
            lineOfInputCursorIsCurrentlyOn = lineNumberCursorShouldBeOn;
        }
        if (lineNumberCursorShouldBeOn > lineOfInputCursorIsCurrentlyOn) {
            this._writeEmitter.fire(ACTION_KEYS.DOWN.repeat(lineNumberCursorShouldBeOn - lineOfInputCursorIsCurrentlyOn));
        } else if (lineNumberCursorShouldBeOn < lineOfInputCursorIsCurrentlyOn) {
            this._writeEmitter.fire(ACTION_KEYS.UP.repeat(lineOfInputCursorIsCurrentlyOn - lineNumberCursorShouldBeOn));
        }
        this._writeEmitter.fire(ACTION_KEYS.MOVE_TO_POSITION_IN_LINE((this._getAbsoluteIndexOnLine(this._cursorIndex) % this._terminalDimensions.columns) + 1));
    }

    setDimensions (dimensions: vscode.TerminalDimensions): void {
        this._terminalDimensions = dimensions;
    }

    private _sendTerminalDimensionsIfNeeded (): void {
        if ((this._lastSentTerminalDimensions == null) || this._lastSentTerminalDimensions.columns !== this._terminalDimensions.columns || this._lastSentTerminalDimensions.rows !== this._terminalDimensions.rows) {
            void this._mvm.eval(`try; if usejava('jvm'); com.mathworks.mde.cmdwin.CmdWinMLIF.setCWSize(${this._terminalDimensions.rows}, ${this._terminalDimensions.columns}); end; end;`);
            this._lastSentTerminalDimensions = this._terminalDimensions;
        }
    }

    private async _evaluateCommand (command: string): Promise<void> {
        this._sendTerminalDimensionsIfNeeded();
        return await (this._mvm.eval(command) as Promise<void>);
    }

    /**
     *
     * @param output Add an output TextEvent to the command window. Stderr is displayed in red.
     */
    addOutput (output: TextEvent): void {
        if (this._initialized) {
            if (output.stream === 0) {
                this.handleText(output.text, true);
            } else {
                this._writeEmitter.fire(ACTION_KEYS.RED_FOREGROUND);
                this.handleText(output.text, true);
                this._writeEmitter.fire(ACTION_KEYS.ALL_DEFAULT_COLORS);
            }
        }
    }

    /**
     * Clears the command window, and also wipes out the terminal's scroll history as well.
     */
    clear (): void {
        this._writeEmitter.fire(ACTION_KEYS.CLEAR_COMPLETELY)
        void vscode.commands.executeCommand('workbench.action.terminal.clear');
    }

    private _updateHasSelectionContext (): void {
        void vscode.commands.executeCommand('setContext', 'matlab.terminalHasSelection', this._anchorIndex !== undefined);
    }

    private _handleCopy (): void {
        if (this._anchorIndex === undefined) {
            return;
        }

        const selectionStart = this._currentPrompt.length + Math.min(this._cursorIndex, this._anchorIndex);
        const selectionEnd = this._currentPrompt.length + Math.max(this._cursorIndex, this._anchorIndex);
        const selection = this._currentLine.slice(selectionStart, selectionEnd);
        void vscode.env.clipboard.writeText(selection);
    }

    private _handlePaste (): void {
        vscode.env.clipboard.readText().then((text: string) => {
            this.handleInput(text);
        }, () => {
            // Ignored
        });
    }

    private _handleEscape (): void {
        this._setToEmptyPrompt();
        this._isLineDirty = true;
    }

    onDidWrite: vscode.Event<string>;
    onDidOverrideDimensions?: vscode.Event<vscode.TerminalDimensions | undefined> | undefined;
    onDidClose?: vscode.Event<number> | undefined;
    onDidChangeName?: vscode.Event<string> | undefined;

    /**
     *
     * @param data Helper used to log input is a readible manner
     */
    private _logInput (data: string): void {
        let shouldPrint = false;
        let s = '[';
        const prefix = ''
        for (let i = 0; i < data.length; i++) {
            let ch = data[i];
            if (data.charCodeAt(i) === 0x1b) {
                ch = 'ESC'
                shouldPrint = true;
            } else {
                if (ch.match(/[a-z0-9,./;'[\]\\`~!@#$%^&*()_+\-=|:'{}<>?]/i) === null) {
                    let hex = data.charCodeAt(i).toString(16);
                    if (hex.length === 1) {
                        hex = '0' + hex;
                    }
                    ch = '\\x' + hex;
                    shouldPrint = true;
                }
            }
            s += prefix + ch;
        }
        s += ']'
        if (shouldPrint) {
            console.log(s);
        }
    }
}
