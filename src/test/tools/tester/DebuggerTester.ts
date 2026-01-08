// Copyright 2024-2025 The MathWorks, Inc.
import * as vet from 'vscode-extension-tester'
import { VSCodeTester } from './VSCodeTester'
import { EditorTester } from './EditorTester'

/**
 * DebuggerTester
 * Used to test the debugging functionality for MATLAB in VSCode.
*/
export class DebuggerTester {
    private readonly vs: VSCodeTester
    public toolbar!: vet.DebugToolbar
    private readonly editor: EditorTester

    private readonly LINE_NUMBERS_CLASS = 'line-numbers';
    private readonly BREAKPOINT_CLASS = 'codicon-debug-breakpoint';
    private readonly DEBUG_HIGHLIGHT_CLASS = 'cdr.debug-top-stack-frame-line';

    public constructor (vs: VSCodeTester, editor: EditorTester) {
        this.vs = vs
        this.editor = editor
    }

    public async setBreakpointOnLine (lineNumber: number): Promise<void> {
        await this.editor.toggleBreakpoint(lineNumber);
        return await this.vs.poll(() => this.isBreakpointOnLine(lineNumber), true, `Expected breakpoint to exist on line ${lineNumber}`);
    }

    public async clearBreakpointOnLine (lineNumber: number): Promise<void> {
        await this.editor.toggleBreakpoint(lineNumber);
        return await this.vs.poll(() => this.isBreakpointOnLine(lineNumber), false, `Expected breakpoint on line ${lineNumber} to be cleared`);
    }

    public async assertStoppedAtLine (lineNumber: number): Promise<void> {
        return await this.vs.poll(() => this.getCurrentExecutionLine(), lineNumber, `Expected debugger to be stopped at ${lineNumber}`)
    }

    public async assertDebugging (): Promise<void> {
        return await this.vs.poll(async () => (await this.getCurrentExecutionLine()) !== -1, true, 'Expected debugger to be stopped at some line');
    }

    public async assertNotDebugging (): Promise<void> {
        return await this.vs.poll(this.getCurrentExecutionLine.bind(this), -1, 'Expected debugger to not be stopped at any line')
    }

    /**
     * Extracts the numeric 'top' pixel value from a style string.
     */
    private extractTopPixel (styleString: string): string | null {
        const match = styleString.match(/top:\s*([\d.]+)px/);
        return (match != null) ? match[1] : null;
    }

    /**
     * Finds the 'top' pixel value for a given line number.
     */
    private async getLineTopPixels (lineNumber: number): Promise<string | null> {
        const lineNumXpath = `//div[contains(@class, '${this.LINE_NUMBERS_CLASS}') and text()='${lineNumber}']`;
        const lineElements = await this.editor.findElements(vet.By.xpath(lineNumXpath));
        if (lineElements.length === 0) return null;
        const lineParent = await lineElements[0].findElement(vet.By.xpath('..'));
        const parentStyle = await lineParent.getAttribute('style');
        return this.extractTopPixel(parentStyle);
    }

    /**
     * Finds the line number for a given 'top' pixel value.
     */
    private async getLineNumberByTopPixels (topPixels: string): Promise<number> {
        const selector = `div[style*="top:${topPixels}px"] .${this.LINE_NUMBERS_CLASS}, div[style*="top: ${topPixels}px"] .${this.LINE_NUMBERS_CLASS}`;
        const lineNumElements = await this.editor.findElements(vet.By.css(selector));
        if (lineNumElements.length === 0) return -1;
        const lineText = await lineNumElements[0].getText();
        return parseInt(lineText, 10);
    }

    /**
     * Returns true if a breakpoint exists on the specified line number.
     */
    private async isBreakpointOnLine (lineNumber: number): Promise<boolean> {
        const topPixels = await this.getLineTopPixels(lineNumber);
        if (topPixels == null) return false;
        const bpSelector = `.${this.BREAKPOINT_CLASS}[style*="top:${topPixels}px"], .${this.BREAKPOINT_CLASS}[style*="top: ${topPixels}px"]`;
        const breakpoints = await this.editor.findElements(vet.By.css(bpSelector));
        return breakpoints.length > 0;
    }

    /**
     * Returns the line number where the debugger is currently paused, or -1 if not found.
     */
    private async getCurrentExecutionLine (): Promise<number> {
        try {
            const debugHighlights = await this.editor.findElements(vet.By.css(`.${this.DEBUG_HIGHLIGHT_CLASS}`));
            if (debugHighlights.length === 0) return -1;
            const parent = await debugHighlights[0].findElement(vet.By.xpath('..'));
            const style = await parent.getAttribute('style');
            const topPixels = this.extractTopPixel(style);
            if (topPixels == null) return -1;
            return await this.getLineNumberByTopPixels(topPixels);
        } catch (e) {
            console.log('Error getting current execution line:\n', e, '\nRetrying...')
            return -1;
        }
    }
}
