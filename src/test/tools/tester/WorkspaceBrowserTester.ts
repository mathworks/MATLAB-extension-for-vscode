// Copyright 2026 The MathWorks, Inc.
import * as vet from 'vscode-extension-tester'
import { WebDriver, By, until, Key } from 'selenium-webdriver'
import * as assert from 'assert'
import { VSCodeTester } from './VSCodeTester'

export class WorkspaceBrowserTester {
    private readonly vs: VSCodeTester
    private readonly driver: WebDriver
    private inFrame: boolean = false
    private handle: string | undefined

    constructor (vs: VSCodeTester) {
        this.vs = vs
        this.driver = vet.VSBrowser.instance.driver
    }

    // ── Frame Switching ─────────────────────────────────────────

    private async switchToFrame (timeout = 10000): Promise<void> {
        if (this.inFrame) return

        this.handle = await this.driver.getWindowHandle()
        await this.driver.switchTo().defaultContent()

        const outerIframe = await this.driver.wait(
            until.elementLocated(By.css('iframe.webview.ready')), timeout,
            'Timed out waiting for outer webview iframe'
        )
        await this.driver.switchTo().frame(outerIframe)

        const innerIframe = await this.driver.wait(
            until.elementLocated(By.id('active-frame')), timeout,
            'Timed out waiting for active-frame iframe'
        )
        await this.driver.switchTo().frame(innerIframe)

        await this.driver.wait(
            until.elementLocated(By.css('.wsb-container')), timeout,
            'Timed out waiting for .wsb-container inside webview'
        )

        this.inFrame = true
    }

    private async switchBack (): Promise<void> {
        if (!this.inFrame) return
        if (this.handle == null) {
            this.handle = await this.driver.getWindowHandle()
        }
        await this.driver.switchTo().window(this.handle)
        this.inFrame = false
    }

    // ── Read Operations ─────────────────────────────────────────

    private async getRowCount (): Promise<number> {
        await this.switchToFrame()
        try {
            const trs = await this.driver.findElements(By.css('.wsb-table tbody tr'))
            return trs.length
        } finally {
            await this.switchBack()
        }
    }

    private async getVariableNames (): Promise<string[]> {
        await this.switchToFrame()
        try {
            const inputs = await this.driver.findElements(By.css('.wsb-table tbody .wsb-name-input'))
            const names: string[] = []
            for (const input of inputs) {
                names.push(await input.getAttribute('value'))
            }
            return names
        } finally {
            await this.switchBack()
        }
    }

    // ── Assertions ──────────────────────────────────────────────

    async assertVariableExists (varName: string, message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(
            this.hasVariable.bind(this, varName), true,
            message !== '' ? message : `Expected variable "${varName}" to exist in WSB`, timeout
        )
    }

    async assertVariableNotExists (varName: string, message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(
            this.hasVariable.bind(this, varName), false,
            message !== '' ? message : `Expected variable "${varName}" to not exist in WSB`, timeout
        )
    }

    async assertVariableValue (varName: string, expected: string, message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(
            this.getVariableField.bind(this, varName, 'value'), expected,
            message !== '' ? message : `Expected variable "${varName}" to have value "${expected}"`, timeout
        )
    }

    async assertVariableClass (varName: string, expected: string, message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(
            this.getVariableField.bind(this, varName, 'class'), expected,
            message !== '' ? message : `Expected variable "${varName}" to have class "${expected}"`, timeout
        )
    }

    async assertVariableSize (varName: string, expected: string, message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(
            this.getVariableField.bind(this, varName, 'size'), expected,
            message !== '' ? message : `Expected variable "${varName}" to have size "${expected}"`, timeout
        )
    }

    async assertRowCount (expected: number, message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(
            this.getRowCount.bind(this), expected,
            message !== '' ? message : `Expected WSB to have ${expected} rows`, timeout
        )
    }

    async assertVariableOrder (expectedNames: string[], message = '', timeout = 30000): Promise<void> {
        const check = async (): Promise<boolean> => {
            const names = await this.getVariableNames()
            if (names.length !== expectedNames.length) return false
            return names.every((name, i) => name === expectedNames[i])
        }
        return await this.vs.poll(
            check.bind(this), true,
            message !== '' ? message : `Expected variable order: [${expectedNames.join(', ')}]`, timeout
        )
    }

    // ── Edit Operations ─────────────────────────────────────────

    async editValue (varName: string, newValue: string): Promise<void> {
        await this.editCell(`tr[data-var="${varName}"] .wsb-value-input`, newValue, Key.ENTER)
    }

    async renameVariable (varName: string, newName: string): Promise<void> {
        await this.editCell(`tr[data-var="${varName}"] .wsb-name-input`, newName, Key.ENTER)
    }

    async editValueAndCancel (varName: string, tempValue: string): Promise<void> {
        await this.editCell(`tr[data-var="${varName}"] .wsb-value-input`, tempValue, Key.ESCAPE)
    }

    // ── Context Menu Operations ────────────────────────────────

    async rightClickRow (varName: string): Promise<void> {
        await this.contextClick(`tr[data-var="${varName}"]`)
    }

    async rightClickColumnHeader (columnName: string): Promise<void> {
        await this.contextClick(`th[data-col="${columnName}"]`)
    }

    async assertContextMenuVisible (message = ''): Promise<void> {
        const elements = await this.driver.findElements(
            By.css('.context-view.monaco-menu-container')
        )
        assert.strictEqual(elements.length > 0, true, message !== '' ? message : 'Expected context menu to be visible')
    }

    async assertContextMenuContains (label: string, message = '', timeout = 10000): Promise<void> {
        const hasLabel = async (): Promise<boolean> => {
            const items = await this.driver.findElements(
                By.css('.context-view.monaco-menu-container .action-label')
            )
            for (const item of items) {
                const text = await item.getText()
                if (text === label) return true
            }
            return false
        }
        return await this.vs.poll(
            hasLabel.bind(this), true,
            message !== '' ? message : `Expected context menu to contain "${label}"`, timeout
        )
    }

    async closeContextMenu (): Promise<void> {
        await this.driver.actions({ async: true }).sendKeys(Key.ESCAPE).perform()
    }

    // ── Sort Operations ─────────────────────────────────────────

    async clickColumnHeader (columnName: string): Promise<void> {
        await this.switchToFrame()
        try {
            const header = await this.driver.findElement(
                By.css(`th[data-col="${columnName}"]`)
            )
            await header.click()
        } finally {
            await this.switchBack()
        }
    }

    // ── Private Helpers ─────────────────────────────────────────

    private async editCell (selector: string, text: string, confirmKey: string): Promise<void> {
        await this.switchToFrame()
        try {
            const input = await this.driver.findElement(By.css(selector))
            const actions = this.driver.actions({ async: true })
            await actions.doubleClick(input).perform()
            await this.waitForEditMode(input)
            await input.sendKeys(text)
            await input.sendKeys(confirmKey)
            await this.waitForReadOnly(input)
        } finally {
            await this.switchBack()
        }
    }

    private async contextClick (selector: string): Promise<void> {
        await this.switchToFrame()
        try {
            const element = await this.driver.findElement(By.css(selector))
            const actions = this.driver.actions({ async: true })
            await actions.contextClick(element).perform()
        } finally {
            await this.switchBack()
        }
    }

    private async waitForEditMode (input: vet.WebElement): Promise<void> {
        await this.driver.wait(async () => {
            const readOnly = await input.getAttribute('readOnly')
            return readOnly === null || readOnly === 'false'
        }, 5000, 'Timed out waiting for input to enter edit mode')
    }

    private async waitForReadOnly (input: vet.WebElement): Promise<void> {
        await this.driver.wait(async () => {
            const readOnly = await input.getAttribute('readOnly')
            return readOnly === 'true'
        }, 5000, 'Timed out waiting for input to return to readonly')
    }

    private async hasVariable (varName: string): Promise<boolean> {
        await this.switchToFrame()
        try {
            const elements = await this.driver.findElements(By.css(`tr[data-var="${varName}"]`))
            return elements.length > 0
        } catch {
            return false
        } finally {
            await this.switchBack()
        }
    }

    private async getVariableField (varName: string, field: 'value' | 'class' | 'size'): Promise<string> {
        await this.switchToFrame()
        try {
            let selector: string
            switch (field) {
                case 'value':
                    selector = `tr[data-var="${varName}"] .wsb-value-input`
                    break
                case 'class':
                    selector = `tr[data-var="${varName}"] td[data-col="Class"] .wsb-text-input`
                    break
                case 'size':
                    selector = `tr[data-var="${varName}"] td[data-col="Size"] .wsb-text-input`
                    break
            }
            const elements = await this.driver.findElements(By.css(selector))
            if (elements.length === 0) return ''
            return await elements[0].getAttribute('value')
        } catch {
            return ''
        } finally {
            await this.switchBack()
        }
    }
}
