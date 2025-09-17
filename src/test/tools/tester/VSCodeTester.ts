// Copyright 2024-2025 The MathWorks, Inc.
import * as vet from 'vscode-extension-tester'
import * as path from 'path'
import * as PollingUtils from '../utils/PollingUtils'
import { TerminalTester } from './TerminalTester'
import { DebuggerTester } from './DebuggerTester'
import * as assert from 'assert'

/**
 * VSCodeTester
 * Based on vscode-extention-tester. This is used for the ui tests under test/ui
*/
export class VSCodeTester {
    private readonly vs: VSCodeTester
    private readonly browser: vet.VSBrowser
    private readonly statusbar: vet.StatusBar
    public readonly workbench: vet.Workbench
    public terminal!: TerminalTester
    public debugger!: DebuggerTester

    public constructor () {
        this.vs = this
        this.browser = vet.VSBrowser.instance
        this.workbench = new vet.Workbench()
        this.statusbar = new vet.StatusBar()
        this.debugger = new DebuggerTester(this)
    }

    public async clearAllNotifications (): Promise<void> {
        const notifications = await this.workbench.getNotifications();
        for (const notification of notifications) {
            await notification.dismiss();
        }
    }

    /**
    * Connects to MATLAB
    */
    public async connectToMATLAB (): Promise<void> {
        const prompt = await this.workbench.openCommandPrompt() as vet.InputBox;
        await prompt.setText('>matlab.changeMatlabConnection')
        await this.selectQuickPick(prompt, 'MATLAB: Change MATLAB Connection')
        await this.selectQuickPick(prompt, 'Connect to MATLAB')
        return await this.assertMATLABConnected()
    }

    /**
    * Disconnects MATLAB
    */
    public async disconnectFromMATLAB (): Promise<void> {
        const prompt = await this.workbench.openCommandPrompt() as vet.InputBox;
        await prompt.setText('>matlab.changeMatlabConnection');
        await this.selectQuickPick(prompt, 'MATLAB: Change MATLAB Connection')
        await this.selectQuickPick(prompt, 'Disconnect from MATLAB')
        return await this.assertMATLABDisconnected()
    }

    /**
     * check for quickpick to contain a label
     */
    private async checkForQuickPick (prompt: vet.InputBox, label: string): Promise<boolean> {
        const quickPicks = await prompt.getQuickPicks()
        const labels = await Promise.all(quickPicks.map(item => item.getLabel()));
        return labels.includes(label);
    }

    /**
     * wait for quickpick to contain a label
     */
    public async selectQuickPick (prompt: vet.InputBox, label: string): Promise<void> {
        await this.poll(this.checkForQuickPick.bind(this, prompt, label), true, `Expected quickpick to contain ${label}`, 5000)
        return await prompt.selectQuickPick(label);
    }

    /**
     * Get the status bar text to indicate if MATLAB connection
     */
    private async getConnectionStatus (): Promise<string> {
        const statusItem = await this.statusbar.findElements(vet.By.xpath('//*[@id="MathWorks.language-matlab"]'))
        const status = await statusItem[0]?.getAttribute('aria-label')
        return status
    }

    /**
     * Poll for MATLAB to connect to VSCode
     */
    public async assertMATLABConnected (): Promise<void> {
        return await this.poll(this.getConnectionStatus.bind(this), 'MATLAB: Connected', 'Expected MATLAB to be connected', 180000)
    }

    /**
     * Poll for MATLAB to disconnect from VSCode
     */
    public async assertMATLABDisconnected (): Promise<void> {
        return await this.poll(this.getConnectionStatus.bind(this), 'MATLAB: Not Connected', 'Expected MATLAB to be disconnected')
    }

    /**
     * Return the path to 'test-files' directory
     */
    public getTestFilesDirectory (): string {
        return path.resolve(__dirname, '..', '..', 'test-files')
    }

    /**
     * Open a file from the 'test-files' directory
     */
    public async openEditor (filename: string): Promise<vet.TextEditor> {
        const filepath = path.resolve(this.getTestFilesDirectory(), filename)
        await this.browser.openResources(filepath)
        return new vet.TextEditor()
    }

    /**
     * Close the editor that is currently active
     */
    public async closeActiveEditor (): Promise<void> {
        const editor = new vet.TextEditor()
        if (await editor.isDirty()) {
            await new vet.EditorView().closeEditor(await editor.getTitle())
            const dialog = new vet.ModalDialog()
            return await dialog.pushButton('Don\'t Save')
        }
        await new vet.EditorView().closeEditor(await editor.getTitle())
        return await PollingUtils.pause(1000) // wait for editor to close
    }

    /**
    * Opens the MATLAB terminal and creates a new terminal tester
    */
    public async openMATLABTerminal (): Promise<TerminalTester> {
        const prompt = await this.workbench.openCommandPrompt() as vet.InputBox
        await prompt.setText('>matlab.openCommandWindow')
        await this.selectQuickPick(prompt, 'MATLAB: Open Command Window');
        await this.assertMATLABConnected()
        const terminal = await new vet.BottomBarPanel().openTerminalView()
        const terminalTester = new TerminalTester(this, terminal)
        this.terminal = terminalTester
        return terminalTester
    }

    public async runCurrentFile (): Promise<void> {
        const prompt = await this.workbench.openCommandPrompt()
        await prompt.setText('>matlab.runFile')
        return await prompt.confirm()
    }

    public async runCurrentSection (): Promise<void> {
        const prompt = await this.workbench.openCommandPrompt()
        await prompt.setText('>matlab.runSection')
        return await prompt.confirm()
    }

    public async setSetting (id: string, value: string): Promise<void> {
        const editor = await this.workbench.openSettings();
        const setting = await editor.findSettingByID(id) as vet.ComboSetting | vet.TextSetting;
        await setting.setValue(value)
        return await new vet.EditorView().closeEditor('Settings')
    }

    public async setCheckBoxSetting (id: string, value: boolean): Promise<void> {
        const editor = await this.workbench.openSettings();
        const setting = await editor.findSettingByID(id) as vet.CheckboxSetting;
        await setting.setValue(value)
        return await new vet.EditorView().closeEditor('Settings')
    }

    public async assertDecorationOnLine (n: number, message = ''): Promise<void> {
        return await this.poll(this.lineHasDecoration.bind(this, n), true, `Expected line ${n} to have decoration. ${message}`)
    }

    private async lineHasDecoration (n: number): Promise<boolean> {
        const editor = new vet.TextEditor()
        const lines = await editor.findElements(vet.By.css('div.view-lines > div'));
        if (n < 1 || n > lines.length) return false;

        const spans = await lines[n - 1].findElements(vet.By.css('span'));
        for (const span of spans) {
            const classAttr = await span.getAttribute('class');
            if (classAttr?.includes('TextEditorDecoration')) {
                return true;
            }
        }
        return false;
    }

    /**
    * Poll for a function return the expected value. Default timeout is 30s
    */
    // eslint-disable-next-line
    public async poll (fn: (...args: any[]) => any, value: any, message = '', timeout = 30000, onFailure?: (result: any) => Promise<void>): Promise<void> {
        const interval = 1000;
        const maxIterations = Math.ceil(timeout / interval);
        let i = 0;
        let result = await fn();

        while (result !== value && i < maxIterations) {
            await PollingUtils.pause(interval);
            result = await fn();
            i++;
        }

        if (result !== value) {
            const filename = `test_failure_${new Date().toISOString().replace(/[:.]/g, '-')}`
            await this.browser.takeScreenshot(filename)
            console.log(`Screenshot saved as ${filename}.png`)
        } else {
            if (message !== '') {
                console.log(`Assertion passed: ${message}`)
            }
        }

        return assert.strictEqual(result, value, `Assertion failed after waiting for ${timeout}ms. ${message}`);
    }
}
