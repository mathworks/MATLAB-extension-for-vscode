// Copyright 2023-2026 The MathWorks, Inc.

import * as path from 'path'
import * as Mocha from 'mocha'
import * as vscode from 'vscode'
import * as utils from './../tools/utils/VSCodeUtils'

export async function run (): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        retries: 3,
        timeout: 600000 // set suite timeout to 10 minutes
    })

    mocha.suite.beforeAll(async function () {
        const MATLAB_PATH = process.env.MATLAB_PATH as string
        if (MATLAB_PATH !== undefined) {
            await utils.setInstallPath(MATLAB_PATH)
        }

        if (process.env.MATLAB_DISABLE_PREWARM_GRAPHICS !== undefined) {
            await vscode.workspace.getConfiguration('MATLAB').update('prewarmGraphics', false, vscode.ConfigurationTarget.Global)
        }
    })

    mocha.suite.beforeEach(async function () {
        await utils.closeAllDocuments()
    })

    const testsRoot = path.resolve(__dirname)

    return await new Promise((resolve, reject) => {
        const test = process.env.test as string
        mocha.addFile(path.resolve(testsRoot, test))

        try {
            // Run the mocha test
            mocha.run(failures => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`))
                } else {
                    resolve()
                }
            })
        } catch (err) {
            console.error(err)
            reject(err)
        }
    })
}
