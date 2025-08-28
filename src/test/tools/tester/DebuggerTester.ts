// Copyright 2024-2025 The MathWorks, Inc.
import * as vet from 'vscode-extension-tester'
// import * as PollingUtils from '../utils/PollingUtils'
import { VSCodeTester } from './VSCodeTester'

/**
 * DebuggerTester
 * Used to test the debugging functionality for MATLAB in VSCode.
*/
export class DebuggerTester {
    private readonly vs: VSCodeTester
    public toolbar!: vet.DebugToolbar

    public constructor (vs: VSCodeTester) {
        this.vs = vs
    }

    public async waitForToolbar (): Promise<void> {
        this.toolbar = await vet.DebugToolbar.create()
    }

    public async assertStoppedAtLine (lineNumber: number): Promise<void> {
        return await this.vs.poll(this.getCurrentExecutionLine.bind(this), lineNumber, `Expected debugger to be stopped at ${lineNumber}`, 60000)
    }

    public async assertNotDebugging (): Promise<void> {
        return await this.vs.poll(this.getCurrentExecutionLine.bind(this), -1, 'Expected debugger to not be stopped at any line', 60000)
    }

    private async getCurrentExecutionLine (): Promise<number> {
        const editor = new vet.TextEditor()
        const breakpoint = await editor.getPausedBreakpoint()
        return await breakpoint?.getLineNumber() ?? -1
    }

    public async setToolbarPosition (position: string): Promise<void> {
        const editor = await this.vs.workbench.openSettings();
        const setting = await editor.findSettingByID('debug.toolBarLocation') as vet.ComboSetting
        await setting.setValue(position)
        return await new vet.EditorView().closeEditor('Settings')
    }
}
