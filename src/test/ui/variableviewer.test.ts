// Copyright 2026 The MathWorks, Inc.
import { VSCodeTester } from '../tools/tester/VSCodeTester'
import { VariableViewerTester } from '../tools/tester/VariableViewerTester'
import { Key } from 'selenium-webdriver'
import { before, afterEach, after } from 'mocha'
import * as assert from 'assert'

suite('Variable Viewer UI Tests', function () {
    let vs: VSCodeTester
    let vv: VariableViewerTester

    before(async function () {
        vs = new VSCodeTester()
        vv = new VariableViewerTester(vs)
        await vs.openEditor('hScript1.m')
        await vs.assertMATLABConnected()
        await vs.openMATLABTerminal()

        if (await vs.isMatlabVersionLessThan('R2023a')) {
            this.skip()
        }

        await vs.openWorkspaceBrowser()
        await vs.terminal.assertContains('>>', 'wait for ready prompt')
        await vs.terminal.executeCommand('clear; clc;')
    })

    afterEach(async function () {
        await vv.closeAllEditorTabs()
        await vs.terminal.executeCommand('clear; clc')
    })

    // ── 1. Grid rendering, cell selection, and keyboard navigation ──

    test('Grid rendering, cell selection, and keyboard navigation', async function () {
        await vs.terminal.executeCommand('A = magic(5);')
        await vs.workspaceBrowser.assertVariableExists('A')
        await vs.workspaceBrowser.openInVariableViewer('A')

        // Verify tab opened with correct banner
        await vv.assertBannerName('A')
        await vv.assertBannerMeta('5x5 double')

        // Verify grid renders with 1-based headers and correct values
        // magic(5) top-left cell is 17
        await vv.assertColumnHeader(1, '1')
        await vv.assertRowHeader(1, '1')
        await vv.assertCellValue(1, 1, '17')

        // Click a cell and verify status bar
        await vv.clickCell(2, 3)
        await vv.assertStatusBarContains('A(2,3)')

        // Arrow key navigation
        await vv.pressKey(Key.ARROW_DOWN)
        await vv.assertStatusBarContains('A(3,3)')
        await vv.pressKey(Key.ARROW_RIGHT)
        await vv.assertStatusBarContains('A(3,4)')

        // Panel reuse: open A again, should reveal existing tab, not create a duplicate
        await vs.workspaceBrowser.openInVariableViewer('A')
        await vv.assertBannerName('A', 'tab should be revealed, not duplicated')
    })

    // ── 2. Large variable scrolling and chunk fetching ──────────────

    test('Large variable scrolling and chunk fetching', async function () {
        await vs.terminal.executeCommand('B = rand(1000, 1000);')
        await vs.workspaceBrowser.assertVariableExists('B')
        await vs.workspaceBrowser.openInVariableViewer('B')

        await vv.assertBannerMeta('1000x1000 double')
        await vv.assertCellsPopulated()

        // Scroll vertically
        await vv.scrollGrid(0, 5000)
        await vv.assertCellsPopulated()

        // Scroll horizontally
        await vv.scrollGrid(3000, 0)
        await vv.assertCellsPopulated()
    })

    // ── 3. Table rendering and column resize ────────────────────────

    test('Table rendering and column resize', async function () {
        await vs.terminal.executeCommand("T = table([\"alpha\";\"bravo\";\"charlie\"], [1;2;3], 'VariableNames', {'Name','Value'});")
        await vs.workspaceBrowser.assertVariableExists('T')
        await vs.workspaceBrowser.openInVariableViewer('T')

        // Verify named column headers and 1-based row indices
        await vv.assertColumnHeader(1, 'Name')
        await vv.assertColumnHeader(2, 'Value')
        await vv.assertRowHeader(1, '1')

        // Drag column 1 border to resize
        const widthBefore = await vv.getColumnWidth(1)
        await vv.dragColumnResize(1, 50)
        const widthAfterDrag = await vv.getColumnWidth(1)
        assert.ok(widthAfterDrag > widthBefore, `Column should be wider after drag (was ${widthBefore}, now ${widthAfterDrag})`)

        // Double-click column 1 border to auto-fit back
        await vv.doubleClickColumnResize(1)
        const widthAfterAutoFit = await vv.getColumnWidth(1)
        assert.ok(widthAfterAutoFit < widthAfterDrag, `Column should shrink after auto-fit (was ${widthAfterDrag}, now ${widthAfterAutoFit})`)
    })

    // ── 4. Unsupported variable type and "Open in MATLAB" ──────────

    test('Unsupported variable type and "Open in MATLAB"', async function () {
        await vs.terminal.executeCommand('S = struct(\'x\', 1, \'y\', 2);')
        await vs.workspaceBrowser.assertVariableExists('S')
        await vs.workspaceBrowser.openInVariableViewer('S')

        await vv.assertPreviewVisible()
    })

    // ── 5. Live refresh, deletion, and type change ──────────────────

    test('Live refresh, deletion, and type change', async function () {
        await vs.terminal.executeCommand('A = magic(5);')
        await vs.workspaceBrowser.assertVariableExists('A')
        await vs.workspaceBrowser.openInVariableViewer('A')
        await vv.assertRendererType('grid')
        await vv.assertCellValue(1, 1, '17')

        // Modify value and verify refresh
        await vs.terminal.executeCommand('A(1,1) = 999;')
        await vv.assertCellValue(1, 1, '999', 'grid should refresh after value change')

        // Change type and verify renderer switch
        await vs.terminal.executeCommand("A = struct('a', 1);")
        await vv.assertRendererType('unsupported', 'should switch to unsupported after type change')

        // Delete variable and verify deleted message
        await vs.terminal.executeCommand('clear A')
        await vv.assertDeletedMessage()

        // Recreate variable and verify recovery
        await vs.terminal.executeCommand('A = 42;')
        await vv.assertRendererType('grid', 'panel should recover after variable is recreated')
        await vv.assertCellValue(1, 1, '42')
    })

    // ── 6. MATLAB disconnect disposes all panels ────────────────────

    test('MATLAB disconnect disposes all panels', async function () {
        await vs.terminal.executeCommand('x = 1; y = 2;')
        await vs.workspaceBrowser.assertVariableExists('x')
        await vs.workspaceBrowser.assertVariableExists('y')

        await vs.workspaceBrowser.openInVariableViewer('x')
        await vv.assertBannerName('x')

        await vs.workspaceBrowser.openInVariableViewer('y')
        await vv.assertBannerName('y')

        // Disconnect MATLAB
        await vs.disconnectFromMATLAB()

        // All variable viewer tabs should be closed
        await vv.assertTabNotExists('x', 'x tab should be closed after disconnect')
        await vv.assertTabNotExists('y', 'y tab should be closed after disconnect')

        // Reconnect and verify Variable Viewer works after recovery
        await vs.connectToMATLAB()
        await vs.openMATLABTerminal()
        await vs.terminal.executeCommand('z = magic(3);')
        await vs.workspaceBrowser.assertVariableExists('z')
        await vs.workspaceBrowser.openInVariableViewer('z')
        await vv.assertBannerName('z')
    })
})
