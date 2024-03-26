// Copyright 2023 The MathWorks, Inc.

import * as path from 'path'
import { runTests } from '@vscode/test-electron'
import { GlobSync } from 'glob'
import * as os from 'os'

async function main (): Promise<void> {
    try {
        // Run the test against minimum supported and latest stable, and insiders VS Code version
        let versions = ['1.67.0', 'stable', 'insiders']

        // If version is specified as insider, run only against insiders
        const VSCODE_VERSION = process.env.VSCODE_VERSION as string
        if (VSCODE_VERSION === 'insider') {
            versions = ['insiders']
        }

        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../../')

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, './index')

        // List of tests to run
        const testsRoot = path.resolve(__dirname)
        const tests = new GlobSync('**/**.test.js', { cwd: testsRoot }).found

        // Download VS Code, unzip it and run the integration test
        for (const version of versions) {
            for (const test of tests) {
                await runTests({
                    version,
                    extensionDevelopmentPath,
                    extensionTestsPath,
                    extensionTestsEnv: { test },
                    launchArgs: ['--user-data-dir', `${os.tmpdir()}`]
                })
            }
        }
    } catch (err) {
        console.log(err)
        console.error('Failed to run tests')
        process.exit(1)
    }
}

void main()
