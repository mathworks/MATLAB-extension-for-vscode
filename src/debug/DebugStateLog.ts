// Copyright 2026 The MathWorks, Inc.

import * as fs from 'fs'

// TEMPORARY diagnostic for the flaky debugging UI test. Records debugging-state changes so the test can show
// whether MATLAB reported that debugging ended before F5 stopped running the file.
// Only active when the UI test runner sets MATLAB_DEBUG_STATE_LOG. Remove once the 'matlab.isDebugging' investigation is done.
const logPath = process.env.MATLAB_DEBUG_STATE_LOG

export function logDebugState (message: string): void {
    if (logPath === undefined || logPath === '') return
    try {
        fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`)
    } catch {
        // Diagnostics only: never let logging affect the extension
    }
}
