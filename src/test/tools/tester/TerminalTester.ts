// Copyright 2024-2025 The MathWorks, Inc.
import * as vet from 'vscode-extension-tester'
import * as PollingUtils from '../utils/PollingUtils'

/**
 * TerminalTester
 * Used to test the MATLAB terminal in VSCode. This is initialized by VSCodeTester#openMATLABTerminal
*/
export class TerminalTester {
    private readonly workbench: vet.Workbench
    private readonly terminal: vet.TerminalView

    public constructor (workbench: vet.Workbench, terminal: vet.TerminalView) {
        this.workbench = workbench
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
        return await PollingUtils.poll(this.getTerminalContent.bind(this), expected, `Assertion on terminal content: ${message}`)
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
        return await PollingUtils.poll(this.doesTerminalContain.bind(this, expected), true, `Assertion on terminal content: ${message}`)
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
