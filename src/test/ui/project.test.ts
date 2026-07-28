// Copyright 2026 The MathWorks, Inc.
import { VSCodeTester } from '../tools/tester/VSCodeTester'
import { Key } from 'vscode-extension-tester'
import { before, after } from 'mocha';
import * as fs from 'fs';
import * as path from 'path';

suite('Project UI Tests', () => {
    let vs: VSCodeTester
    const workspaceFolder = path.resolve(__dirname, '..', '..', '..', '.s')

    function cleanProjectFiles (): void {
        const tomlFile = path.join(workspaceFolder, 'matlab.toml')
        if (fs.existsSync(tomlFile)) fs.unlinkSync(tomlFile)
        const repoFolder = path.join(workspaceFolder, 'repoFolder')
        if (fs.existsSync(repoFolder)) fs.rmSync(repoFolder, { recursive: true })
    }

    before(async () => {
        vs = new VSCodeTester();
        cleanProjectFiles()
        await vs.openEditor('hScript1.m')
        await vs.assertMATLABConnected()
        await vs.closeActiveEditor()
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

        // Cleanup
        const projFile = path.join(workspaceFolder, 'TestProject.prj')
        if (fs.existsSync(projFile)) fs.unlinkSync(projFile)
        const resourcesDir = path.join(workspaceFolder, 'resources')
        if (fs.existsSync(resourcesDir)) fs.rmSync(resourcesDir, { recursive: true })
    });

    test('Test prompt when opening project with dependencies', async function () {
        await vs.openMATLABTerminal()

        if (await vs.isMatlabVersionLessThan('R2026b')) {
            this.skip()
        }

        // Copy fixture files into workspace
        const fixtureSource = path.resolve(__dirname, '..', 'test-files', 'project-with-deps')
        fs.copyFileSync(
            path.join(fixtureSource, 'matlab.toml'),
            path.join(workspaceFolder, 'matlab.toml')
        )
        fs.cpSync(
            path.join(fixtureSource, 'repoFolder'),
            path.join(workspaceFolder, 'repoFolder'),
            { recursive: true }
        )

        // Register the package repository and ensure myPkg1 is not installed
        const repoPath = path.join(workspaceFolder, 'repoFolder').replace(/\\/g, '/')
        await vs.terminal.executeCommand('try,mpmRemoveRepository("myRepo");end')
        await vs.terminal.executeCommand(`mpmAddRepository("myRepo","${repoPath}")`)
        await vs.terminal.executeCommand('try,mpmuninstall("myPkg1",Prompt=false,Force=true);end')

        // Hide terminal panel so we can verify the extension brings it forward
        await vs.terminal.closeTerminal()

        // Right-click matlab.toml and open project
        const menu = await vs.openFileContextMenu('matlab.toml')
        await menu.select('MATLAB: Project', 'MATLAB: Open Project...')

        // The extension should automatically bring the terminal forward with the prompt
        await vs.terminal.assertMATLABTerminalVisible()
        await vs.terminal.assertContains('Do you want to continue? [YES/no]:', 'Expected terminal to show dependency prompt')

        // Accept dependencies and verify the project opens
        await vs.terminal.type('YES')
        await vs.terminal.type(Key.ENTER)
        await vs.assertStatusBarItemContains('MATLAB project', 'Expected project to open after installing dependencies', 60000)

        // Close project and verify
        await vs.executeCommand('MATLAB: Close Project')
        await vs.assertStatusBarItemNotContains('MATLAB project', 'Expected project status bar item to disappear after closing')

        // Cleanup
        await vs.terminal.executeCommand('try,mpmuninstall("myPkg1",Prompt=false,Force=true);end')
        cleanProjectFiles()
    })
});
