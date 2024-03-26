// Copyright 2024 The MathWorks, Inc.
import * as vet from 'vscode-extension-tester'
import * as path from 'path'
import * as PollingUtils from '../utils/PollingUtils'
import { TerminalTester } from './TerminalTester'

/**
 * VSCodeTester
 * Based on vscode-extention-tester. This is used for the ui tests under test/ui
*/
export class VSCodeTester {
    private readonly browser: vet.VSBrowser
    private readonly workbench: vet.Workbench
    private readonly statusbar: vet.StatusBar
    public terminal!: TerminalTester

    public constructor () {
        this.browser = vet.VSBrowser.instance
        this.workbench = new vet.Workbench()
        this.statusbar = new vet.StatusBar()
    }

    /**
     * Get the status bar text to indicate if MATLAB connection
     */
    private async getConnectionStatus (): Promise<string> {
        const statusItem = await this.statusbar.findElements(vet.By.xpath('//*[@id="MathWorks.language-matlab"]'))
        const status = await statusItem[0]?.getAttribute('aria-label')
        return status;
    }

    /**
     * Poll for MATLAB to connect to VSCode
     */
    public async assertMATLABConnected (): Promise<void> {
        return await PollingUtils.poll(this.getConnectionStatus.bind(this), 'MATLAB: Connected', 'Expected MATLAB to be connected', 180000)
    }

    /**
     * Poll for MATLAB to disconnect from VSCode
     */
    public async assertMATLABDisconnected (): Promise<void> {
        return await PollingUtils.poll(this.getConnectionStatus.bind(this), 'MATLAB: Not Connected', 'Expected MATLAB to be disonnected')
    }

    /**
     * Open a file from the 'test-files' directory
     */
    public async openDocument (filename: string): Promise<void> {
        const filepath = path.resolve(__dirname, '..', '..', 'test-files', filename)
        await this.browser.openResources(filepath)
    }

    /**
     * Close the editor that is currently active
     */
    public async closeActiveDocument (): Promise<void> {
        const editor = new vet.TextEditor();
        if (await editor.isDirty()) {
            await new vet.EditorView().closeEditor(await editor.getTitle());
            const dialog = new vet.ModalDialog();
            return await dialog.pushButton('Don\'t Save');
        }
        return await new vet.EditorView().closeEditor(await editor.getTitle());
    }

    /**
    * Opens the MATLAB terminal and creates a new terminal tester
    */
    public async openMATLABTerminal (): Promise<TerminalTester> {
        const prompt = await this.workbench.openCommandPrompt()
        await prompt.setText('>matlab.openCommandWindow')
        await prompt.confirm()
        const terminal = await new vet.BottomBarPanel().openTerminalView();
        const terminalTester = new TerminalTester(this.workbench, terminal)
        this.terminal = terminalTester
        return terminalTester
    }

    public async selectFromNotification (label: string): Promise<void> {
        await this.waitForNotifications()
        const notifications = await this.workbench.getNotifications();
        const notification = notifications[0];
        return await notification.takeAction(label)
    }

    public async clearNotifications (): Promise<void> {
        let notifications = await this.workbench.getNotifications();
        while (notifications.length > 0) {
            await notifications[0].dismiss();
            notifications = await this.workbench.getNotifications();
        }
    }

    private async waitForNotifications (): Promise<void> {
        await PollingUtils.poll(this.doNotificationsExist.bind(this), true)
    }

    private async doNotificationsExist (): Promise<boolean> {
        const notifications = await this.workbench.getNotifications();
        return notifications.length > 0
    }

    public async runCurrentFile (): Promise<void> {
        const prompt = await this.workbench.openCommandPrompt()
        await prompt.setText('>matlab.runFile')
        return await prompt.confirm()
    }
}
