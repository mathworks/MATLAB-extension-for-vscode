// Copyright 2024-2025 The MathWorks, Inc.
import * as vet from 'vscode-extension-tester'
import { VSCodeTester } from './VSCodeTester'

/**
 * TerminalTester
 * Used to test the MATLAB terminal in VSCode. This is initialized by VSCodeTester#openMATLABTerminal
*/
export class TerminalTester {
    private readonly vs: VSCodeTester
    private readonly terminal: vet.TerminalView

    public constructor (vs: VSCodeTester, terminal: vet.TerminalView) {
        this.vs = vs
        this.terminal = terminal
    }

    /**
     * Execute a command in the MATLAB terminal
     */
    public async executeCommand (command: string): Promise<void> {
        if (command.endsWith('clc')) {
            return await this.terminal.executeCommand(`${command}, disp(' ')`); // workaround since clc is broken in 22b
        }
        return await this.terminal.executeCommand(command)
    }

    /**
     * Assert content of the MATLAB terminal
     */
    public async assertContent (expected: string, message: string): Promise<void> {
        return await this.vs.poll(this.getTerminalContent.bind(this), expected, `Assertion on terminal content: ${message}`)
    }

    /**
     * Get the content of the MATLAB terminal
     */
    private async getTerminalContent (): Promise<string> {
        let content = await this.terminal.getText();
        content = content.trim()
        return content
    }

    /**
    * Assert the MATLAB terminal contains some content
    */
    public async assertContains (expected: string, message: string): Promise<void> {
        return await this.vs.poll(this.doesTerminalContain.bind(this, expected), true, `Assertion on terminal content: ${message}`)
    }

    /**
     * Assert the MATLAB terminal does not contain some content
     */
    public async assertNotContains (expected: string, message: string): Promise<void> {
        return await this.vs.poll(this.doesTerminalNotContain.bind(this, expected), true, `Assertion on terminal content: ${message}`)
    }

    /**
     * Checks if the MATLAB terminal contains some content (no polling)
     */
    private async doesTerminalContain (expected: string): Promise<boolean> {
        const content = await this.getTerminalContent()
        return content.includes(expected)
    }

    /**
     * Checks if the MATLAB terminal does not contain some content (no polling)
     */
    private async doesTerminalNotContain (expected: string): Promise<boolean> {
        const content = await this.getTerminalContent()
        return !content.includes(expected)
    }

    public async type (text: string): Promise<void> {
        const container = await this.terminal.findElement(vet.By.className('xterm-helper-textarea'));
        return await container.sendKeys(text)
    }

    /**
     * Get the current cursor position in the MATLAB terminal
     * @returns The cursor position as { line: number, column: number } (both 0-based)
     */
    public async getCursorPosition (): Promise<{ line: number, column: number }> {
        const workbench = new vet.Workbench()
        const position = await workbench.executeCommand('matlab.getCursorPosition')
        return position as { line: number, column: number }
    }

    /**
     * Assert that the cursor is at the expected position
     * @param expectedLine Expected line number (0-based)
     * @param expectedColumn Expected column number (0-based)
     * @param message Message to display if assertion fails
     */
    public async assertCursorPosition (expectedLine: number, expectedColumn: number, message: string): Promise<void> {
        return await this.vs.poll(
            async () => await this.getCursorPosition(),
            { line: expectedLine, column: expectedColumn },
            `Assertion on cursor position: ${message}`,
            5000,
            async (result) => {
                console.log(`Expected cursor at line ${expectedLine}, column ${expectedColumn}, but got line ${result.line}, column ${result.column}`)
            }
        )
    }
}
