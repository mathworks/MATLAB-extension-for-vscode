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
     * Extracts content from the terminal based on the provided regular expression.
     *
     * @param regexp A regexp used to match content within the terminal
     * @returns An array of string results which match the provided RegExp, or null if no results are found
     */
    public async extractContent (regexp: RegExp): Promise<string[] | null> {
        const content = await this.terminal.getText()

        if (regexp.global) {
            const matchResults = content.match(regexp)
            return matchResults
        } else {
            const matchResults = content.match(regexp)
            return matchResults === null ? null : [matchResults[0]]
        }
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
     * Checks if the MATLAB terminal contains some content (no polling)
     */
    private async doesTerminalContain (expected: string): Promise<boolean> {
        const content = await this.getTerminalContent()
        return content.includes(expected)
    }

    public async type (text: string): Promise<void> {
        const container = await this.terminal.findElement(vet.By.className('xterm-helper-textarea'));
        return await container.sendKeys(text)
    }
}
