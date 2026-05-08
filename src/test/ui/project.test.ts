// Copyright 2026 The MathWorks, Inc.
import { VSCodeTester } from '../tools/tester/VSCodeTester'
import { before, afterEach, after } from 'mocha';
import * as fs from 'fs';
import * as path from 'path';

suite('Project UI Tests', () => {
    let vs: VSCodeTester
    const workspaceFolder = path.resolve(__dirname, '..', '..', '..', '.s')

    before(async () => {
        vs = new VSCodeTester();
        await vs.openEditor('hScript1.m')
        await vs.assertMATLABConnected()
        await vs.closeActiveEditor()
    });

    afterEach(async () => {
        // Delete project
        const projFile = path.join(workspaceFolder, 'TestProject.prj')
        if (fs.existsSync(projFile)) {
            fs.unlinkSync(projFile)
        }
        const resourcesDir = path.join(workspaceFolder, 'resources')
        if (fs.existsSync(resourcesDir)) {
            fs.rmSync(resourcesDir, { recursive: true })
        }
    });

    after(async () => {
        await vs.disconnectFromMATLAB()
    });

    // Native context menus are not supported on macOS by vscode-extension-tester
    // https://github.com/redhat-developer/vscode-extension-tester/blob/main/KNOWN_ISSUES.md#macos-known-limitations-of-native-objects
    (process.platform === 'darwin' ? test.skip : test)('Test status bar when creating a new matlab project', async () => {
        // Create matlab project from context menu and verify status bar
        const menu = await vs.openExplorerContextMenu()
        await menu.select('MATLAB: Project', 'MATLAB: New Project...')
        await vs.typeInInputBox('TestProject')
        await vs.assertStatusBarItemContains('MATLAB project', 'Expected MATLAB project status bar item to be visible')
        // Close matlab project and verify status bar
        await vs.executeCommand('MATLAB: Close Project')
        await vs.assertStatusBarItemNotContains('MATLAB project', 'Expected MATLAB project status bar item to not be visible after closing project')
    })
});
