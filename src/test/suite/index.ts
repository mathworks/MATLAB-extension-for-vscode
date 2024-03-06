// Copyright 2023 The MathWorks, Inc.

import * as path from 'path'
import * as Mocha from 'mocha'
import * as vs from '../tester/VSCodeTester'
import * as os from 'os'

export async function run (): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        timeout: 600000 // set suite timeout to 10 minutes
    })

    mocha.suite.beforeEach(async function () {
        await vs.closeAllDocuments()
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
