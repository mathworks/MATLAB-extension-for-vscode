// Copyright 2026 The MathWorks, Inc.
import * as vet from 'vscode-extension-tester'
import { WebDriver, By, WebElement } from 'selenium-webdriver'
import { VSCodeTester } from './VSCodeTester'
import * as assert from 'assert'

export class VariableViewerTester {
    private readonly vs: VSCodeTester
    private readonly driver: WebDriver

    constructor (vs: VSCodeTester) {
        this.vs = vs
        this.driver = vet.VSBrowser.instance.driver
    }

    // ── Frame Switching ─────────────────────────────────────────

    private async switchToFrame (timeout = 15000): Promise<void> {
        // VS Code renders all webview iframes (sidebar and editor) as siblings in a
        // shared overlay, so we can't distinguish VV from WSB by DOM ancestry. Instead,
        // iterate from last to first (most recently opened is last) and enter each iframe
        // to check for .vv-container inside its active-frame.
        await this.driver.wait(async () => {
            await this.driver.switchTo().defaultContent()
            const all = await this.driver.findElements(By.css('iframe.webview'))
            for (let i = all.length - 1; i >= 0; i--) {
                try {
                    await this.driver.switchTo().frame(all[i])
                    const inner = await this.driver.findElements(By.id('active-frame'))
                    if (inner.length === 0) { await this.driver.switchTo().defaultContent(); continue }
                    await this.driver.switchTo().frame(inner[0])
                    const vv = await this.driver.findElements(By.css('.vv-container'))
                    if (vv.length > 0) return true
                    await this.driver.switchTo().defaultContent()
                } catch { await this.driver.switchTo().defaultContent() }
            }
            return null
        }, timeout, 'Timed out waiting for Variable Viewer webview iframe')
    }

    private async switchBack (): Promise<void> {
        const handle = await this.driver.getWindowHandle()
        await this.driver.switchTo().window(handle)
    }

    // ── Primitive Helpers ────────────────────────────────────────

    private async getElementText (selector: string): Promise<string> {
        await this.switchToFrame()
        try {
            const elements = await this.driver.findElements(By.css(selector))
            return elements.length > 0 ? await elements[0].getText() : ''
        } finally { await this.switchBack() }
    }

    private async hasElement (selector: string): Promise<boolean> {
        await this.switchToFrame()
        try {
            return (await this.driver.findElements(By.css(selector))).length > 0
        } finally { await this.switchBack() }
    }

    // ── Banner ──────────────────────────────────────────────────

    async assertBannerName (expected: string, message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(() => this.getElementText('.vv-banner-name'), expected,
            message !== '' ? message : `Expected banner name "${expected}"`, timeout)
    }

    async assertBannerMeta (expected: string, message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(() => this.getElementText('.vv-banner-meta'), expected,
            message !== '' ? message : `Expected banner meta "${expected}"`, timeout)
    }

    // ── Grid Cells ──────────────────────────────────────────────

    async assertCellValue (row: number, col: number, expected: string, message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(
            () => this.getElementText(`.vv-cell[data-row="${row}"][data-col="${col}"]`), expected,
            message !== '' ? message : `Expected cell (${row},${col}) = "${expected}"`, timeout)
    }

    async assertCellsPopulated (timeout = 30000): Promise<void> {
        return await this.vs.poll(() => this.hasElement('.vv-cell-loading'), false,
            'Expected all visible cells to be populated', timeout)
    }

    // ── Headers ─────────────────────────────────────────────────

    async assertColumnHeader (colIndex: number, expected: string, message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(this.getColumnHeaderText.bind(this, colIndex), expected,
            message !== '' ? message : `Expected column ${colIndex} header "${expected}"`, timeout)
    }

    private async getColumnHeaderText (colIndex: number): Promise<string> {
        await this.switchToFrame()
        try {
            for (const header of await this.driver.findElements(By.css('.vv-col-header'))) {
                if (await header.getAttribute('aria-colindex') === String(colIndex)) {
                    return await (await header.findElement(By.css('span'))).getText()
                }
            }
            return ''
        } finally { await this.switchBack() }
    }

    async assertRowHeader (rowIndex: number, expected: string, message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(this.getRowHeaderText.bind(this, rowIndex), expected,
            message !== '' ? message : `Expected row ${rowIndex} header "${expected}"`, timeout)
    }

    private async getRowHeaderText (rowIndex: number): Promise<string> {
        await this.switchToFrame()
        try {
            for (const header of await this.driver.findElements(By.css('.vv-row-header'))) {
                if (await header.getAttribute('aria-rowindex') === String(rowIndex)) {
                    return await header.getText()
                }
            }
            return ''
        } finally { await this.switchBack() }
    }

    // ── Cell Selection & Status Bar ─────────────────────────────

    async clickCell (row: number, col: number): Promise<void> {
        await this.switchToFrame()
        try {
            await (await this.driver.findElement(By.css(`.vv-cell[data-row="${row}"][data-col="${col}"]`))).click()
        } finally { await this.switchBack() }
    }

    async assertStatusBarContains (substring: string, message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(async () => (await this.getElementText('.vv-status-text')).includes(substring),
            true, message !== '' ? message : `Expected status bar to contain "${substring}"`, timeout)
    }

    // ── Keyboard Navigation ─────────────────────────────────────

    async pressKey (key: string): Promise<void> {
        await this.switchToFrame()
        try {
            await (await this.driver.findElement(By.css('.vv-grid-outer'))).sendKeys(key)
        } finally { await this.switchBack() }
    }

    // ── Scrolling ───────────────────────────────────────────────

    async scrollGrid (deltaX: number, deltaY: number): Promise<void> {
        await this.switchToFrame()
        try {
            const gridWrap = await this.driver.findElement(By.css('.vv-grid-wrap'))
            await this.driver.executeScript(
                'arguments[0].scrollTop += arguments[1]; arguments[0].scrollLeft += arguments[2];',
                gridWrap, deltaY, deltaX)
        } finally { await this.switchBack() }
    }

    // ── Column Resize ───────────────────────────────────────────

    async getColumnWidth (colIndex: number): Promise<number> {
        await this.switchToFrame()
        try {
            for (const header of await this.driver.findElements(By.css('.vv-col-header'))) {
                if (await header.getAttribute('aria-colindex') === String(colIndex)) {
                    return parseFloat(await header.getCssValue('width'))
                }
            }
            return NaN
        } finally { await this.switchBack() }
    }

    async dragColumnResize (colIndex: number, deltaX: number): Promise<void> {
        await this.switchToFrame()
        try {
            const handle = await this.findResizeHandle(colIndex)
            await this.driver.actions({ async: true })
                .move({ origin: handle })
                .press()
                .move({ origin: handle, x: deltaX, y: 0 })
                .release()
                .perform()
        } finally { await this.switchBack() }
    }

    async doubleClickColumnResize (colIndex: number): Promise<void> {
        await this.switchToFrame()
        try {
            await this.driver.actions({ async: true })
                .doubleClick(await this.findResizeHandle(colIndex))
                .perform()
        } finally { await this.switchBack() }
    }

    private async findResizeHandle (colIndex: number): Promise<WebElement> {
        for (const header of await this.driver.findElements(By.css('.vv-col-header'))) {
            if (await header.getAttribute('aria-colindex') === String(colIndex)) {
                return await header.findElement(By.css('.vv-col-resize-handle'))
            }
        }
        assert.fail(`Column header ${colIndex} not found`)
    }

    // ── Unsupported Renderer ────────────────────────────────────

    async assertPreviewVisible (message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(() => this.hasElement('.vv-preview-wrap'), true,
            message !== '' ? message : 'Expected preview renderer to be visible', timeout)
    }

    // ── Renderer Type ───────────────────────────────────────────

    async assertRendererType (type: 'grid' | 'unsupported', message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(async () => {
            if (await this.hasElement('.vv-grid-outer')) return 'grid'
            if (await this.hasElement('.vv-preview-wrap')) return 'unsupported'
            return 'unknown'
        }, type, message !== '' ? message : `Expected renderer type "${type}"`, timeout)
    }

    // ── Deleted State ───────────────────────────────────────────

    async assertDeletedMessage (message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(() => this.hasElement('.vv-deleted-message'), true,
            message !== '' ? message : 'Expected "Variable Not Found" message', timeout)
    }

    // ── Tab Assertions ──────────────────────────────────────────

    async assertTabNotExists (titleSubstring: string, message = '', timeout = 30000): Promise<void> {
        return await this.vs.poll(this.isTabOpen.bind(this, titleSubstring), false,
            message !== '' ? message : `Expected no tab matching "${titleSubstring}"`, timeout)
    }

    private async isTabOpen (titleSubstring: string): Promise<boolean> {
        const titles = await new vet.EditorView().getOpenEditorTitles()
        return titles.some(t => t.includes(titleSubstring))
    }

    async closeAllEditorTabs (): Promise<void> {
        await new vet.EditorView().closeAllEditors()
    }
}
