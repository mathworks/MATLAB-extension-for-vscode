// Copyright 2026 The MathWorks, Inc.

import { registerMockVscode } from './mock-vscode'
import * as path from 'path'
import * as Mocha from 'mocha'
import * as glob from 'glob'

// Register mock before any test imports that depend on vscode
registerMockVscode()

async function runTests (): Promise<void> {
    const mocha = new Mocha({
        ui: 'tdd',
        reporter: 'spec'
    })

    const testRoot = path.resolve(__dirname, '**', '*.test.js').split(path.sep).join('/')
    const testFiles = glob.sync(testRoot)
    testFiles.forEach((file: string) => mocha.addFile(file))

    return await new Promise<void>((resolve, reject) => {
        mocha.run((failures: number) => {
            failures > 0 ? reject(new Error(`${failures} tests failed`)) : resolve()
        })
    })
}

runTests().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
})
