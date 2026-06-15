// Copyright 2024-2025 The MathWorks, Inc.
import * as vet from 'vscode-extension-tester'
import * as path from 'path'
import * as PollingUtils from '../utils/PollingUtils'
import { TerminalTester } from './TerminalTester'
import { WorkspaceBrowserTester } from './WorkspaceBrowserTester'
import * as assert from 'assert'
import { EditorTester } from './EditorTester'

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
    public workspaceBrowser!: WorkspaceBrowserTester

    public constructor () {
        this.vs = this
        this.browser = vet.VSBrowser.instance
        this.workbench = new vet.Workbench()
        this.statusbar = new vet.StatusBar()
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
     * Determines if the connected MATLAB's version is less than the provided version.
     *
     * @param version The MATLAB version to check against (e.g. "R2023a")
     */
    public async isMatlabVersionLessThan (version: string): Promise<boolean> {
        const matlabVersion = await this.getMatlabVersion()
        return matlabVersion != null && matlabVersion < version
    }

    /**
     * Determines if MATLAB version has been outputted into the terminal.
     * Returns true if MATLAB version is not null.
     */
    private async isMATLABVersionAvailable (): Promise<boolean> {
        const version = await this.terminal.extractContent(/R\d\d\d\d[ab]/)
        return version != null
    }

    /**
     * Gets the MATLAB version of the connected MATLAB.
     *
     * **Note:** As a side effect of calling this, the terminal will be cleared.
     *
     * @returns The MATLAB version (e.g. "R2023a") of the connected MATLAB version
     */
    private async getMatlabVersion (): Promise<string | null> {
        await this.assertMATLABConnected()
        await this.terminal.executeCommand('version')
        await this.poll(this.isMATLABVersionAvailable.bind(this), true, 'Expected version output in terminal', 100000)
        const version = await this.terminal.extractContent(/R\d\d\d\d[ab]/)
        await this.terminal.executeCommand('clc')
        return version === null ? null : version[0]
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
    public async openEditor (filename: string): Promise<EditorTester> {
        const filepath = path.resolve(this.getTestFilesDirectory(), filename)
        await this.browser.openResources(filepath)
        return new EditorTester(this.vs)
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
    public async openMATLABTerminal (): Promise<void> {
        await this.executeCommand('matlab.openCommandWindow')
        await this.pause(5000)
        const terminal = await new vet.BottomBarPanel().openTerminalView()
        const terminalTester = new TerminalTester(this, terminal)
        this.terminal = terminalTester
    }

    /**
    * Opens the Workspace Browser sidebar and creates a new WorkspaceBrowserTester
    */
    public async openWorkspaceBrowser (): Promise<void> {
        const activityBar = new vet.ActivityBar()
        const matlabControl = await activityBar.getViewControl('MATLAB')
        if (matlabControl != null) {
            await matlabControl.click()
        }
        await this.poll(this.isSideBarOpen.bind(this), true, 'Expected MATLAB sidebar to open')
        this.workspaceBrowser = new WorkspaceBrowserTester(this)
    }

    private async isSideBarOpen (): Promise<boolean> {
        try {
            const sideBar = new vet.SideBarView()
            const content = sideBar.getContent()
            const sections = await content.getSections()
            return sections.length > 0
        } catch {
            return false
        }
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

    public async executeCommand (command: string): Promise<void> {
        console.log(`Executing command: ${command}`)
        return await this.workbench.executeCommand(command)
    }

    /**
     * Open the Explorer sidebar and right-click on empty space to open the context menu
     */
    public async openExplorerContextMenu (): Promise<vet.ContextMenu> {
        const activityBar = new vet.ActivityBar()
        const explorerControl = await activityBar.getViewControl('Explorer')
        await explorerControl?.openView()

        let contextMenu: vet.ContextMenu | null = null
        await this.poll(async () => {
            try {
                const driver = this.browser.driver
                await driver.actions().sendKeys(vet.Key.ESCAPE).perform()
                await PollingUtils.pause(500)

                const sideBar = new vet.SideBarView()
                const sections = await sideBar.getContent().getSections()
                const section = sections[0]
                await section.expand()
                const rect = await section.getRect()
                await driver.actions()
                    .move({ origin: section, x: 0, y: Math.floor(rect.height / 2) - 10 })
                    .contextClick()
                    .perform()
                contextMenu = await new vet.ContextMenu(this.workbench).wait(5000)
                return true
            } catch (e) {
                return false
            }
        }, true, 'Expected to open explorer context menu')
        return contextMenu!
    }

    /**
     * Type text into an open input box and confirm with Enter
     */
    public async typeInInputBox (text: string): Promise<void> {
        const input = await vet.InputBox.create()
        await input.setText(text)
        await input.confirm()
    }

    /**
     * Get the text of a status bar item that contains the given substring
     */
    private async getStatusBarItemText (substring: string): Promise<string | null> {
        try {
            const items = await this.statusbar.findElements(vet.By.css('.statusbar-item a'))
            for (const item of items) {
                const label = await item.getAttribute('aria-label')
                if (label?.includes(substring)) {
                    return label
                }
            }
            return null
        } catch (e) {
            return null
        }
    }

    /**
     * Poll for a status bar item containing the given text to be visible
     */
    public async assertStatusBarItemContains (text: string, message = '', timeout = 30000): Promise<void> {
        return await this.poll(
            async () => (await this.getStatusBarItemText(text)) !== null,
            true,
            message !== '' ? message : `Expected status bar item containing "${text}" to be visible`,
            timeout
        )
    }

    /**
     * Poll for a status bar item containing the given text to not be visible
     */
    public async assertStatusBarItemNotContains (text: string, message = '', timeout = 30000): Promise<void> {
        return await this.poll(
            async () => (await this.getStatusBarItemText(text)) === null,
            true,
            message !== '' ? message : `Expected status bar item containing "${text}" to not be visible`,
            timeout
        )
    }

    /**
    * Pause the test for the specified time
    */
    public async pause (ms: number): Promise<void> {
        return await PollingUtils.pause(ms);
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
