// Copyright 2026 The MathWorks, Inc.
import { VSCodeTester } from '../tools/tester/VSCodeTester'
import { before, afterEach, after } from 'mocha';

suite('Workspace Browser UI Tests', function () {
    let vs: VSCodeTester

    before(async function () {
        vs = new VSCodeTester();
        await vs.openEditor('hScript1.m')
        await vs.assertMATLABConnected()
        await vs.openMATLABTerminal()

        if (await vs.isMatlabVersionLessThan('R2023a')) {
            // Workspace browser only supported on R2023a and later - skip tests
            this.skip()
        }

        await vs.openWorkspaceBrowser()
        await vs.terminal.assertContains('>>', 'wait for ready prompt')
        await vs.terminal.executeCommand('clc')
    });

    afterEach(async function () {
        await vs.terminal.executeCommand('clear; clc')
        await vs.workspaceBrowser.assertRowCount(0, 'workspace should be empty after clear')
    });

    after(async function () {
        await vs.disconnectFromMATLAB()
    });

    // ── Variable Display ────────────────────────────────────────

    test('Variable appears in WSB after creation in terminal', async function () {
        await vs.terminal.executeCommand('x = 5;')
        await vs.workspaceBrowser.assertVariableExists('x', 'x should appear in workspace')
        await vs.workspaceBrowser.assertVariableValue('x', '5', 'value should be 5')
        await vs.workspaceBrowser.assertVariableClass('x', 'double', 'class should be double')
        await vs.workspaceBrowser.assertVariableSize('x', '1×1', 'size should be 1×1')
    })

    test('Multiple variables display correctly', async function () {
        await vs.terminal.executeCommand("x = 5; y = 'hello'; z = [1 2 3];")
        await vs.workspaceBrowser.assertRowCount(3, 'three variables should be shown')
        await vs.workspaceBrowser.assertVariableExists('x')
        await vs.workspaceBrowser.assertVariableExists('y')
        await vs.workspaceBrowser.assertVariableExists('z')
        await vs.workspaceBrowser.assertVariableClass('y', 'char')
        await vs.workspaceBrowser.assertVariableSize('z', '1×3')
    })

    test('Variable removal reflected after clear', async function () {
        await vs.terminal.executeCommand('x = 5;')
        await vs.workspaceBrowser.assertVariableExists('x')
        await vs.terminal.executeCommand('clear x')
        await vs.workspaceBrowser.assertVariableNotExists('x', 'x should be removed after clear')
    })

    test('Variable value updates on reassignment', async function () {
        await vs.terminal.executeCommand('x = 5;')
        await vs.workspaceBrowser.assertVariableValue('x', '5')
        await vs.terminal.executeCommand('x = 10;')
        await vs.workspaceBrowser.assertVariableValue('x', '10', 'value should update to 10')
    })

    // ── Edit Value ──────────────────────────────────────────────

    test('Edit value via double-click and Enter', async function () {
        await vs.terminal.executeCommand('x = 5;')
        await vs.workspaceBrowser.assertVariableExists('x')
        await vs.workspaceBrowser.editValue('x', '42')
        await vs.workspaceBrowser.assertVariableValue('x', '42', 'value should be updated to 42')
    })

    test('Edit value cancel via Escape reverts', async function () {
        await vs.terminal.executeCommand('x = 5;')
        await vs.workspaceBrowser.assertVariableExists('x')
        await vs.workspaceBrowser.editValueAndCancel('x', '999')
        await vs.workspaceBrowser.assertVariableValue('x', '5', 'value should remain 5 after Escape')
    })

    // ── Rename Variable ─────────────────────────────────────────

    test('Rename variable via double-click on name', async function () {
        await vs.terminal.executeCommand('x = 5;')
        await vs.workspaceBrowser.assertVariableExists('x')
        await vs.workspaceBrowser.renameVariable('x', 'myVar')
        await vs.workspaceBrowser.assertVariableNotExists('x', 'old name should be gone')
        await vs.workspaceBrowser.assertVariableExists('myVar', 'new name should appear')
        await vs.workspaceBrowser.assertVariableValue('myVar', '5', 'value should be preserved')
    })

    test('Rename preserves value and updates display', async function () {
        await vs.terminal.executeCommand('data = [1 2 3 4 5];')
        await vs.workspaceBrowser.assertVariableExists('data')
        await vs.workspaceBrowser.renameVariable('data', 'results')
        await vs.workspaceBrowser.assertVariableExists('results')
        await vs.workspaceBrowser.assertVariableSize('results', '1×5', 'size should be preserved')
        await vs.workspaceBrowser.assertVariableClass('results', 'double', 'class should be preserved')
    })

    // ── Context Menu ───────────────────────────────────────────

    // Note: Native context menus are not supported on macOS by vscode-extension-tester
    // https://github.com/redhat-developer/vscode-extension-tester/blob/main/KNOWN_ISSUES.md#macos-known-limitations-of-native-objects

    test('Right-click on row shows context menu with expected items', async function () {
        if (process.platform === 'darwin') this.skip()

        await vs.terminal.executeCommand('x = 5;')
        await vs.workspaceBrowser.assertVariableExists('x')
        await vs.workspaceBrowser.rightClickRow('x')
        await vs.workspaceBrowser.assertContextMenuVisible('Context menu should appear after right-clicking a row')
        await vs.workspaceBrowser.assertContextMenuContains('Delete', 'Context menu should contain "Delete"')
        await vs.workspaceBrowser.assertContextMenuContains('Rename', 'Context menu should contain "Rename"')
        await vs.workspaceBrowser.assertContextMenuContains('Edit Value', 'Context menu should contain "Edit Value"')
        await vs.workspaceBrowser.closeContextMenu()
    })

    test('Right-click on column header shows context menu with sort options', async function () {
        if (process.platform === 'darwin') this.skip()

        await vs.terminal.executeCommand('x = 5;')
        await vs.workspaceBrowser.assertVariableExists('x')
        await vs.workspaceBrowser.rightClickColumnHeader('Name')
        await vs.workspaceBrowser.assertContextMenuVisible('Context menu should appear after right-clicking a header')
        await vs.workspaceBrowser.assertContextMenuContains('Sort Ascending', 'Context menu should contain "Sort Ascending"')
        await vs.workspaceBrowser.assertContextMenuContains('Sort Descending', 'Context menu should contain "Sort Descending"')
        await vs.workspaceBrowser.closeContextMenu()
    })

    // ── Sort by Header Click ────────────────────────────────────

    test('Click Name header sorts ascending and descending', async function () {
        await vs.terminal.executeCommand('b = 1; a = 2; c = 3;')
        await vs.workspaceBrowser.assertRowCount(3)
        // Click a different column first so that clicking Name guarantees ascending
        await vs.workspaceBrowser.clickColumnHeader('Class')
        await vs.workspaceBrowser.clickColumnHeader('Name')
        await vs.workspaceBrowser.assertVariableOrder(['a', 'b', 'c'], 'should be sorted A-Z')
        // Second click on same column toggles to descending
        await vs.workspaceBrowser.clickColumnHeader('Name')
        await vs.workspaceBrowser.assertVariableOrder(['c', 'b', 'a'], 'should be sorted Z-A')
    })

    test('Sort persists after new variable creation', async function () {
        await vs.terminal.executeCommand('b = 1; a = 2;')
        await vs.workspaceBrowser.assertRowCount(2)
        // Click a different column first, then Name, to guarantee Name/ascending
        await vs.workspaceBrowser.clickColumnHeader('Class')
        await vs.workspaceBrowser.clickColumnHeader('Name')
        await vs.workspaceBrowser.assertVariableOrder(['a', 'b'])
        await vs.terminal.executeCommand('aa = 3;')
        await vs.workspaceBrowser.assertRowCount(3)
        await vs.workspaceBrowser.assertVariableOrder(['a', 'aa', 'b'], 'sort should be maintained')
    })
});
