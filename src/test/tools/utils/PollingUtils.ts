// Copyright 2023-2025 The MathWorks, Inc.

import * as assert from 'assert'

const DEFAULT_TIMEOUT = 30000;

/**
 * Pause the test for the specified time
 */
export const pause = async (ms: number): Promise<void> => await new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Poll for a function return the expected value. Default timeout is 30s
 */
// eslint-disable-next-line
export async function poll (fn: (...args: any[]) => any, value: any, message = '', timeout = DEFAULT_TIMEOUT): Promise<void> {
    const interval = 1000
    const maxIterations = Math.ceil(timeout / interval)
    let i = 0
    let result = await fn()
    while (result !== value && i < maxIterations) {
        await pause(1000)
        result = await fn()
        i++
    }
    return assert.strictEqual(result, value, `Assertion failed after waiting for ${timeout}ms. ${message}`)
}
