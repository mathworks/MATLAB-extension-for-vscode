// Copyright 2026 The MathWorks, Inc.
import * as assert from 'assert'
import * as vet from 'vscode-extension-tester'
import { VSCodeTester } from './VSCodeTester'

export class TestExplorerTester {
    private readonly vs: VSCodeTester

    public constructor (vs: VSCodeTester) {
        this.vs = vs
    }

    public async openTestExplorer (): Promise<void> {
        const activityBar = new vet.ActivityBar()
        const testingControl = await activityBar.getViewControl('Testing')
        assert.ok(testingControl, 'Testing activity bar icon should be present')
        const title = await testingControl.getTitle()
        assert.ok(title.startsWith('Testing'), `Expected Testing view control in activity bar, got: ${title}`)
        await testingControl.openView()
    }

    public async assertWelcomeContentVisible (): Promise<void> {
        const sideBar = new vet.SideBarView()
        await this.vs.poll(async () => {
            const elements = await sideBar.findElements(vet.By.xpath('//*[contains(text(), "Add Test Folder") or contains(text(), "Add Test File") or contains(text(), "MATLAB")]'))
            return elements.length > 0
        }, true, 'Expected MATLAB Test Explorer content in Testing view', 10000)
    }

    public async assertCommandsInPalette (expectedCommands: string[]): Promise<void> {
        const prompt = await this.vs.workbench.openCommandPrompt() as vet.InputBox
        await prompt.setText('>MATLAB: Add Test')

        let labels: string[] = []
        await this.vs.poll(async () => {
            const picks = await prompt.getQuickPicks()
            labels = await Promise.all(picks.map(p => p.getLabel()))
            return labels.length > 0
        }, true, 'Expected quick picks to appear after filtering', 10000)

        await prompt.cancel()

        for (const command of expectedCommands) {
            this.assertCommandPresentOnce(labels, command)
        }
    }

    private assertCommandPresentOnce (labels: string[], command: string): void {
        const matches = labels.filter(label => label.includes(command))
        assert.strictEqual(matches.length, 1, `Expected one "${command}" command`)
    }

    public async assertNoErrorNotifications (): Promise<void> {
        const workbench = new vet.Workbench()
        const notifications = await workbench.getNotifications()
        for (const notification of notifications) {
            const type = await notification.getType()
            const message = await notification.getMessage()
            assert.notStrictEqual(
                type,
                vet.NotificationType.Error,
                `Unexpected error notification: ${message}`
            )
        }
    }
}
