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

    /**
     * Assert that the terminal contains yellow-colored text matching the expected string.
     */
    public async assertTextIsYellow (expected: string, message: string): Promise<void> {
        return await this.vs.poll(this.hasTextColor.bind(this, expected, 'yellow'), true, `Assertion on terminal color: ${message}`)
    }

    /**
     * Assert that the terminal contains text in the default (white) color.
     */
    public async assertTextIsWhite (expected: string, message: string): Promise<void> {
        return await this.vs.poll(this.hasTextColor.bind(this, expected, 'white'), true, `Assertion on terminal color: ${message}`)
    }

    /**
     * Assert that the terminal contains text with inline color styling (from syntax highlighting).
     */
    public async assertTextHasColor (expected: string, message: string): Promise<void> {
        return await this.vs.poll(this.hasInlineColor.bind(this, expected), true, `Assertion on terminal color: ${message}`)
    }

    /**
     * Assert that the terminal text matching expected has uniform color (no distinct syntax highlighting).
     * When text is selected, xterm applies a single selection foreground color to all spans,
     * replacing the per-token syntax colors.
     */
    public async assertTextHasUniformColor (expected: string, message: string): Promise<void> {
        return await this.vs.poll(this.hasUniformColor.bind(this, expected), true, `Assertion on terminal color: ${message}`)
    }

    private async getStylesForText (expected: string): Promise<string[] | null> {
        try {
            const rows = await this.terminal.findElements(vet.By.css('.xterm-rows span'))
            const styles: string[] = []
            for (const row of rows) {
                const text = await row.getText()
                if (text.includes(expected)) {
                    styles.push(await row.getAttribute('style') ?? '')
                }
            }
            return styles
        } catch {
            return null
        }
    }

    private async hasUniformColor (expected: string): Promise<boolean> {
        const styles = await this.getStylesForText(expected)
        if (styles == null || styles.length === 0) return false
        return new Set(styles).size === 1
    }

    private async hasInlineColor (expected: string): Promise<boolean> {
        const styles = await this.getStylesForText(expected)
        if (styles == null) return false
        return styles.some(style => style.includes('color:'))
    }

    private static readonly COLOR_SELECTORS: Record<string, string> = {
        yellow: '.xterm-fg-3, .xterm-fg-11'
    }

    private async hasTextColor (expected: string, color: string): Promise<boolean> {
        if (color === 'white') {
            return await this.isTextDefaultColor(expected)
        }
        const selector = TerminalTester.COLOR_SELECTORS[color]
        const elements = await this.terminal.findElements(vet.By.css(selector))
        for (const el of elements) {
            if ((await el.getText()).includes(expected)) {
                return true
            }
        }
        return false
    }

    // White (default) means: text exists in the terminal DOM but has no xterm-fg-* color class
    private async isTextDefaultColor (expected: string): Promise<boolean> {
        const rows = await this.terminal.findElements(vet.By.css('.xterm-rows span'))
        for (const row of rows) {
            const text = await row.getText()
            if (text.includes(expected)) {
                const classAttr = await row.getAttribute('class')
                if (classAttr?.match(/xterm-fg-\d+/) == null) {
                    return true
                }
            }
        }
        return false
    }

    public async type (text: string): Promise<void> {
        const container = await this.terminal.findElement(vet.By.className('xterm-helper-textarea'));
        return await container.sendKeys(text)
    }

    public async closeTerminal (): Promise<void> {
        await this.vs.executeCommand('workbench.action.togglePanel')
        await this.assertMATLABTerminalNotVisible()
    }

    public async assertMATLABTerminalNotVisible (timeout = 5000): Promise<void> {
        await this.vs.poll(
            async () => !(await this.isPanelDisplayed()),
            true,
            'Expected terminal panel to not be visible',
            timeout
        )
    }

    public async assertMATLABTerminalVisible (timeout = 30000): Promise<void> {
        await this.vs.poll(
            async () => await this.isPanelDisplayed(),
            true,
            'Expected terminal panel to be visible',
            timeout
        )
    }

    private async isPanelDisplayed (): Promise<boolean> {
        const panel = new vet.BottomBarPanel()
        return await panel.isDisplayed().catch(() => false)
    }
}
