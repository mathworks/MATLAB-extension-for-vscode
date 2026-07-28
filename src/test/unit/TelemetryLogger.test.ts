// Copyright 2026 The MathWorks, Inc.

/* eslint-disable import/first */

// Use the unified vscode mock (registered by runTest.ts via registerMockVscode)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const vscode = require('./mocks/vscode')

// Mock node-fetch — capture calls without hitting the network
import mock = require('mock-require')

const fetchCalls: Array<{ url: string, init: any }> = []
let fetchResponse: { ok: boolean, status: number, statusText: string } = {
    ok: true,
    status: 200,
    statusText: 'OK'
}
let fetchShouldReject: Error | undefined

const fetchStub = (url: string, init: any): Promise<any> => {
    fetchCalls.push({ url, init })
    if (fetchShouldReject !== undefined) {
        return Promise.reject(fetchShouldReject)
    }
    return Promise.resolve(fetchResponse)
}
mock('node-fetch', { default: fetchStub, __esModule: true })

import * as assert from 'assert'
import { suite, test, setup, teardown } from 'mocha'
import TelemetryLogger, { TelemetryEvent } from '../../services/telemetry/TelemetryLogger'

// Wait for the fetch promise chain (.then/.catch) inside sendEvent to settle.
async function flushMicrotasks (): Promise<void> {
    await new Promise(resolve => setImmediate(resolve))
}

const EXTENSION_VERSION = '1.2.3'

function makeEvent (overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
    return {
        eventKey: 'ML_VS_CODE_SOME_EVENT',
        data: { foo: 'bar' },
        ...overrides
    }
}

suite('TelemetryLogger', () => {
    let logger: TelemetryLogger
    let consoleErrorStub: (...args: unknown[]) => void
    let consoleErrorCalls: unknown[][]
    let originalConsoleError: typeof console.error

    setup(() => {
        // Reset shared mock state
        vscode._state.isTelemetryEnabled = true
        vscode._state.sessionId = 'test-session-id'
        vscode._state.telemetrySetting = true
        fetchCalls.length = 0
        fetchResponse = { ok: true, status: 200, statusText: 'OK' }
        fetchShouldReject = undefined

        // Silence and capture console.error so failure-path tests can inspect it
        consoleErrorCalls = []
        originalConsoleError = console.error
        consoleErrorStub = (...args: unknown[]) => { consoleErrorCalls.push(args) }
        console.error = consoleErrorStub as typeof console.error

        logger = new TelemetryLogger(EXTENSION_VERSION)
    })

    teardown(() => {
        console.error = originalConsoleError
    })

    suite('shouldLogTelemetry gating', () => {
        test('does not send when VS Code telemetry is disabled', async () => {
            vscode._state.isTelemetryEnabled = false

            logger.logEvent(makeEvent())
            await flushMicrotasks()

            assert.strictEqual(fetchCalls.length, 0)
        })

        test('does not send when VS Code telemetry is disabled, even for the telemetry setting change event', async () => {
            vscode._state.isTelemetryEnabled = false

            logger.logEvent({
                eventKey: 'ML_VS_CODE_SETTING_CHANGE',
                data: { setting_name: 'telemetry' }
            })
            await flushMicrotasks()

            assert.strictEqual(fetchCalls.length, 0)
        })

        test('sends when both VS Code telemetry and matlab.telemetry are enabled', async () => {
            vscode._state.isTelemetryEnabled = true
            vscode._state.telemetrySetting = true

            logger.logEvent(makeEvent())
            await flushMicrotasks()

            assert.strictEqual(fetchCalls.length, 1)
        })

        test('does not send when matlab.telemetry is disabled', async () => {
            vscode._state.telemetrySetting = false

            logger.logEvent(makeEvent())
            await flushMicrotasks()

            assert.strictEqual(fetchCalls.length, 0)
        })

        test('sends the telemetry setting-change event even when matlab.telemetry is disabled', async () => {
            vscode._state.telemetrySetting = false

            logger.logEvent({
                eventKey: 'ML_VS_CODE_SETTING_CHANGE',
                data: { setting_name: 'telemetry' }
            })
            await flushMicrotasks()

            assert.strictEqual(fetchCalls.length, 1)
        })
    })

    suite('sendEvent request shape', () => {
        test('POSTs to the configured endpoint', async () => {
            logger.logEvent(makeEvent())
            await flushMicrotasks()

            assert.strictEqual(fetchCalls.length, 1)
            assert.strictEqual(fetchCalls[0].init.method, 'POST')
        })

        test('includes all required UDC headers with the extension version', async () => {
            logger.logEvent(makeEvent())
            await flushMicrotasks()

            const headers = fetchCalls[0].init.headers
            assert.strictEqual(headers['Content-Type'], 'application/json')
            assert.strictEqual(headers['x-mw-udc-client-version'], '1.0')
            assert.strictEqual(headers['x-mw-udc-application-name'], 'MATLAB_EXTENSION_FOR_VSCODE')
            assert.strictEqual(headers['x-mw-udc-application-version'], EXTENSION_VERSION)
        })

        test('wraps event data in the UDC envelope with the correct product', async () => {
            const data = { setting_name: 'installPath', new_value: '/opt/matlab' }
            logger.logEvent({ eventKey: 'ML_VS_CODE_SETTING_CHANGE', data })
            await flushMicrotasks()

            const body = JSON.parse(fetchCalls[0].init.body)
            assert.strictEqual(body.Event.length, 1)

            const entry = body.Event[0]
            assert.strictEqual(entry.sessionKey, 'test-session-id')
            assert.strictEqual(entry.eventKey, 'ML_VS_CODE_SETTING_CHANGE')
            assert.ok(typeof entry.eventDate === 'string' && entry.eventDate.length > 0)

            const eventData = JSON.parse(entry.eventData)
            assert.deepStrictEqual(eventData, {
                logDDUXData: {
                    product: 'ML_VS_CODE',
                    keyValues: data
                }
            })
        })

        test('event date is a valid ISO-8601 timestamp with the trailing Z sliced off', async () => {
            logger.logEvent(makeEvent())
            await flushMicrotasks()

            const eventDate: string = JSON.parse(fetchCalls[0].init.body).Event[0].eventDate
            // Should look like "2026-07-06T12:34:56.789" — 23 chars, no trailing Z
            assert.ok(!eventDate.endsWith('Z'), `eventDate should not end in Z, got "${eventDate}"`)
            assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/.test(eventDate),
                `eventDate should be ISO-8601 without trailing Z, got "${eventDate}"`)
        })
    })

    suite('failure handling', () => {
        test('logs to console.error when the response is not ok', async () => {
            fetchResponse = { ok: false, status: 500, statusText: 'Internal Server Error' }

            logger.logEvent(makeEvent())
            await flushMicrotasks()

            assert.strictEqual(consoleErrorCalls.length, 1)
            const message = String(consoleErrorCalls[0][0])
            assert.ok(message.includes('500'), `expected message to include status code, got: ${message}`)
            assert.ok(message.includes('Internal Server Error'),
                `expected message to include status text, got: ${message}`)
        })

        test('logs to console.error when fetch itself rejects', async () => {
            fetchShouldReject = new Error('network down')

            logger.logEvent(makeEvent())
            await flushMicrotasks()

            assert.strictEqual(consoleErrorCalls.length, 1)
            assert.strictEqual(consoleErrorCalls[0][0], 'Telemetry post error: ')
            assert.strictEqual((consoleErrorCalls[0][1] as Error).message, 'network down')
        })

        test('does not throw synchronously when fetch rejects', () => {
            fetchShouldReject = new Error('network down')

            assert.doesNotThrow(() => logger.logEvent(makeEvent()))
        })
    })
})
