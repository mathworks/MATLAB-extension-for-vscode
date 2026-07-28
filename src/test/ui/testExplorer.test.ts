// Copyright 2026 The MathWorks, Inc.
import { VSCodeTester } from '../tools/tester/VSCodeTester'
import { TestExplorerTester } from '../tools/tester/TestExplorerTester'
import { before, after } from 'mocha';

suite('Test Explorer UI Tests', () => {
    let vs: VSCodeTester
    let testExplorer: TestExplorerTester

    before(async () => {
        vs = new VSCodeTester();
        testExplorer = new TestExplorerTester(vs)
        await vs.openEditor('hScript1.m')
        await vs.assertMATLABConnected()
        await vs.closeActiveEditor()
    });

    after(async () => {
        await vs.disconnectFromMATLAB()
    });

    test('Test Explorer view is available and shows welcome content', async () => {
        await testExplorer.openTestExplorer()
        await testExplorer.assertWelcomeContentVisible()
    })

    test('Testing commands appear in Command Palette', async () => {
        await testExplorer.assertCommandsInPalette(['Add Test Folder', 'Add Test File'])
    })

    test('Run All Tests does not error when no tests are configured', async () => {
        await vs.executeCommand('MATLAB: Run All Tests')
        await testExplorer.assertNoErrorNotifications()
    })

    test('Welcome view persists after MATLAB disconnect', async () => {
        await testExplorer.openTestExplorer()
        await vs.disconnectFromMATLAB()
        await testExplorer.assertWelcomeContentVisible()
        await vs.connectToMATLAB()
    })
});
