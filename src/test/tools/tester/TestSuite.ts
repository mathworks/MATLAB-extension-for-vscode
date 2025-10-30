// Copyright 2024-2025 The MathWorks, Inc.
import { GlobSync } from 'glob'
import * as path from 'path'
import { ExTester, ReleaseQuality } from 'vscode-extension-tester'
import * as PollingUtils from '../utils/PollingUtils'
import * as fs from 'fs';
import * as os from 'os';

export class TestSuite {
    private readonly storageFolder: string
    private readonly mochaConfig: string
    private readonly vscodeSettings: string
    private readonly vsixPath: string
    private readonly testsRoot: string
    private readonly vscodeVersion: string
    private readonly releaseQuality: ReleaseQuality

    public constructor () {
        this.storageFolder = path.join(__dirname, '..', '..', '..', '..', 's')
        this.mochaConfig = path.join(__dirname, '..', 'config', '.mocharc.js')
        const pjson = require(path.resolve('package.json')) // eslint-disable-line
        this.vsixPath = path.resolve(`${pjson.name}-${pjson.version}.vsix`) // eslint-disable-line
        this.testsRoot = path.resolve(__dirname, '..', '..', 'ui')

        // fetch MATLAB_Path from env variable and write vscode settings file
        const MATLAB_PATH = process.env.MATLAB_PATH as string

        const settingsjson = path.join(__dirname, '..', 'config', 'settings.json')
        const settings = JSON.stringify({
            'MATLAB.installPath': MATLAB_PATH,
            'MATLAB.telemetry': false,
            'MATLAB.startDebuggerAutomatically': true,
            'window.dialogStyle': 'custom',
            'terminal.integrated.copyOnSelection': true,
            'debug.toolBarLocation': 'docked',
            'workbench.startupEditor': 'none',
            'terminal.integrated.sendKeybindingsToShell': true,
            'editor.action.toggleTabFocusMode': false
        })
        fs.writeFileSync(settingsjson, settings)
        this.vscodeSettings = settingsjson

        // fetch VSCODE_VERSION from env variable and set release quality and version
        const VSCODE_VERSION = process.env.VSCODE_VERSION as string
        if (VSCODE_VERSION === 'insider') {
            this.releaseQuality = ReleaseQuality.Insider
            this.vscodeVersion = 'latest'
        } else {
            this.releaseQuality = ReleaseQuality.Stable
            this.vscodeVersion = VSCODE_VERSION ?? 'max'
        }
    }

    public getTestList (): string[] {
        const tests = new GlobSync('*.test.js', { cwd: this.testsRoot }).found
        return tests
    }

    /**
     * Queues the array of tests provided to each run in a separate VSCode instance
     */
    public async enqueueTests (tests: string[]): Promise<void> {
        let failed = false;
        const exTester = new ExTester(this.storageFolder, this.releaseQuality, undefined)
        await exTester.downloadCode(this.vscodeVersion)
        await exTester.downloadChromeDriver(this.vscodeVersion)
        await exTester.installVsix({ vsixFile: this.vsixPath })
        console.log(`Queueing tests:\n${tests.join('\n')}\n`)
        for (const test of tests) {
            const testPath = path.join(this.testsRoot, test)
            console.log(`Running test: ${test}`)
            try {
                const exitCode = await exTester.runTests(testPath, {
                    resources: [this.storageFolder],
                    config: this.mochaConfig,
                    settings: this.vscodeSettings
                })
                if (exitCode !== 0) {
                    failed = true;
                    console.error('\x1b[31m%s\x1b[0m', `Test failed: ${test} (exit code: ${exitCode})`);
                } else {
                    console.log('\x1b[34m%s\x1b[0m', `Test passed: ${test}`);
                }
            } catch (err) {
                failed = true;
                console.error('\x1b[31m%s\x1b[0m', err)
            }
            await PollingUtils.pause(30000); // wait for state to be reset before running next test
        }
        if (failed) {
            console.error('\x1b[31m%s\x1b[0m', 'One or more tests failed.');
            process.exit(1);
        }
    }
}
