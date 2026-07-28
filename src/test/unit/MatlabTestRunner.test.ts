// Copyright 2026 The MathWorks, Inc.

/* eslint-disable import/first */
// Register vscode mock BEFORE any imports that depend on it
// eslint-disable-next-line @typescript-eslint/no-var-requires
const vscode = require('./mocks/vscode')
const Module = require('module')
const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request: string, ...args: any[]) {
    if (request === 'vscode') return 'vscode'
    return originalResolveFilename.call(this, request, ...args)
};
(require as any).cache.vscode = {
    id: 'vscode', filename: 'vscode', loaded: true,
    exports: vscode, children: [], paths: [], path: '', isPreloading: false, require: require
}

import * as sinon from 'sinon'
import * as assert from 'assert'
import { EventEmitter } from 'events'
import Notification from '../../notifications/Notifications'

// --- Mock Factories ---

interface MockMVM extends EventEmitter {
    getMatlabState: sinon.SinonStub
    feval: sinon.SinonStub
    interrupt: sinon.SinonStub
    on: (event: string, listener: (...args: any[]) => void) => any
}

function createMockMvm (state = 'connected'): MockMVM {
    const emitter = new EventEmitter()
    const mvm = Object.assign(emitter, {
        getMatlabState: sinon.stub().returns(state),
        feval: sinon.stub().resolves({}),
        interrupt: sinon.stub()
    })
    // Make on() return a Disposable
    const originalOn = emitter.on.bind(emitter)
    ;(mvm as any).on = (event: string, listener: (...args: any[]) => void) => {
        originalOn(event, listener)
        return new vscode.Disposable(() => emitter.removeListener(event, listener))
    }
    return mvm as unknown as MockMVM
}

function createMockClient (): any {
    const listeners: Record<string, Function> = {}
    return {
        onNotification: sinon.stub().callsFake((name: string, handler: Function) => {
            listeners[name] = handler
            return new vscode.Disposable(() => { delete listeners[name] })
        }),
        sendNotification: sinon.stub(),
        _trigger: (name: string, data: any) => {
            if (listeners[name]) listeners[name](data)
        }
    }
}

function createMockTelemetryLogger (): any {
    return { logEvent: sinon.stub() }
}

function createStubbedTestRun (): any {
    return {
        enqueued: sinon.stub(),
        started: sinon.stub(),
        passed: sinon.stub(),
        failed: sinon.stub(),
        errored: sinon.stub(),
        skipped: sinon.stub(),
        appendOutput: sinon.stub(),
        end: sinon.stub()
    }
}

function createStubbedController (run: any): any {
    const items = vscode.createMockTestItemCollection()
    return {
        items,
        createTestItem: (id: string, label: string, uri?: any) => vscode.createMockTestItem(id, label, uri),
        createRunProfile: sinon.stub().callsFake((_label: string, _kind: any, handler: Function) => {
            return { runHandler: handler, dispose: sinon.stub() }
        }),
        createTestRun: sinon.stub().returns(run),
        resolveHandler: undefined,
        dispose: sinon.stub()
    }
}

// --- Helpers ---

/** Imports MatlabTestRunner with the mocked vscode module. */
async function importRunner (): Promise<any> {
    const mod = await import('../../services/testing/MatlabTestRunner')
    return mod.default
}

/** Creates a test item and adds it to the controller. */
function addTestItemToController (controller: any, id: string, label: string, filePath: string): any {
    const uri = vscode.Uri.file(filePath)
    const item = vscode.createMockTestItem(id, label, uri)
    controller.items.add(item)
    return item
}

// --- Tests ---

describe('MatlabTestRunner', () => {
    let MatlabTestRunner: any
    let mockMvm: MockMVM
    let mockClient: any
    let mockTelemetry: any
    let mockRun: any
    let controller: any
    let runner: any
    let runHandler: Function

    before(async () => {
        MatlabTestRunner = await importRunner()
    })

    beforeEach(() => {
        mockMvm = createMockMvm('connected')
        mockClient = createMockClient()
        mockTelemetry = createMockTelemetryLogger()
        mockRun = createStubbedTestRun()
        controller = createStubbedController(mockRun)

        runner = new MatlabTestRunner(controller, mockClient, mockMvm, mockTelemetry)
        runHandler = controller.createRunProfile.firstCall.args[2]
    })

    afterEach(() => {
        sinon.restore()
    })

    describe('Test Result Counts', () => {
        it('should report pass/fail/skip counts correctly after test run completes', async () => {
            const item1 = addTestItemToController(controller, 'TestA/testPass', 'testPass', '/test.m')
            const item2 = addTestItemToController(controller, 'TestA/testFail', 'testFail', '/test.m')
            const item3 = addTestItemToController(controller, 'TestA/testSkip', 'testSkip', '/test.m')

            const request = new vscode.TestRunRequest([item1, item2, item3])
            const tokenSource = new vscode.CancellationTokenSource()
            await runHandler(request, tokenSource.token)

            const runId = mockClient.sendNotification.firstCall.args[1].runId

            mockClient._trigger(Notification.TestRunEvent, {
                runId,
                event: { type: 'started', testName: 'TestA/testPass', testFile: '/test.m' }
            })
            mockClient._trigger(Notification.TestRunEvent, {
                runId,
                event: { type: 'finished', testName: 'TestA/testPass', testFile: '/test.m', status: 'passed', duration: 0.1 }
            })
            mockClient._trigger(Notification.TestRunEvent, {
                runId,
                event: { type: 'started', testName: 'TestA/testFail', testFile: '/test.m' }
            })
            mockClient._trigger(Notification.TestRunEvent, {
                runId,
                event: { type: 'finished', testName: 'TestA/testFail', testFile: '/test.m', status: 'failed', diagnostics: [{ message: 'Expected 2, got 3' }] }
            })
            mockClient._trigger(Notification.TestRunEvent, {
                runId,
                event: { type: 'started', testName: 'TestA/testSkip', testFile: '/test.m' }
            })
            mockClient._trigger(Notification.TestRunEvent, {
                runId,
                event: { type: 'finished', testName: 'TestA/testSkip', testFile: '/test.m', status: 'incomplete' }
            })

            sinon.assert.calledOnce(mockRun.passed)
            sinon.assert.calledOnce(mockRun.failed)
            sinon.assert.calledOnce(mockRun.skipped)
        })

        it('should update counts correctly on re-run after fixing a test', async () => {
            const item1 = addTestItemToController(controller, 'TestA/testFix', 'testFix', '/test.m')

            // First run: test fails
            const request1 = new vscode.TestRunRequest([item1])
            const token1 = new vscode.CancellationTokenSource()
            await runHandler(request1, token1.token)

            const runId1 = mockClient.sendNotification.firstCall.args[1].runId
            mockClient._trigger(Notification.TestRunEvent, {
                runId: runId1,
                event: { type: 'finished', testName: 'TestA/testFix', testFile: '/test.m', status: 'failed', diagnostics: [{ message: 'assertion failed' }] }
            })
            mockClient._trigger(Notification.TestRunComplete, { runId: runId1 })

            sinon.assert.calledOnce(mockRun.failed)
            assert.strictEqual(mockRun.passed.callCount, 0)

            // Second run: test passes (create fresh run)
            const mockRun2 = createStubbedTestRun()
            controller.createTestRun.returns(mockRun2)

            const request2 = new vscode.TestRunRequest([item1])
            const token2 = new vscode.CancellationTokenSource()
            await runHandler(request2, token2.token)

            const runId2 = mockClient.sendNotification.secondCall.args[1].runId
            mockClient._trigger(Notification.TestRunEvent, {
                runId: runId2,
                event: { type: 'finished', testName: 'TestA/testFix', testFile: '/test.m', status: 'passed', duration: 0.05 }
            })

            sinon.assert.calledOnce(mockRun2.passed)
            assert.strictEqual(mockRun2.failed.callCount, 0)
        })

    })

    describe('Real-time Streaming', () => {
        it('should stream results in real-time (not batched at completion)', async () => {
            const item1 = addTestItemToController(controller, 'T/test1', 'test1', '/t.m')
            const item2 = addTestItemToController(controller, 'T/test2', 'test2', '/t.m')

            const request = new vscode.TestRunRequest([item1, item2])
            const tokenSource = new vscode.CancellationTokenSource()
            await runHandler(request, tokenSource.token)

            const runId = mockClient.sendNotification.firstCall.args[1].runId

            // First test starts and finishes — results applied immediately
            mockClient._trigger(Notification.TestRunEvent, { runId, event: { type: 'started', testName: 'T/test1', testFile: '/t.m' } })
            sinon.assert.calledOnce(mockRun.started)
            sinon.assert.calledWith(mockRun.started, item1)

            mockClient._trigger(Notification.TestRunEvent, { runId, event: { type: 'finished', testName: 'T/test1', testFile: '/t.m', status: 'passed', duration: 0.5 } })
            sinon.assert.calledOnce(mockRun.passed)

            // Second test hasn't started yet — verify no batching
            assert.strictEqual(mockRun.started.callCount, 1)

            // Second test starts — incremental update
            mockClient._trigger(Notification.TestRunEvent, { runId, event: { type: 'started', testName: 'T/test2', testFile: '/t.m' } })
            assert.strictEqual(mockRun.started.callCount, 2)
            sinon.assert.calledWith(mockRun.started.secondCall, item2)
        })
    })

    describe('Diagnostics', () => {
        it('should display structured diagnostic message for failed test', async () => {
            const item = addTestItemToController(controller, 'T/testFail', 'testFail', '/test.m')

            const request = new vscode.TestRunRequest([item])
            const tokenSource = new vscode.CancellationTokenSource()
            await runHandler(request, tokenSource.token)

            const runId = mockClient.sendNotification.firstCall.args[1].runId

            mockClient._trigger(Notification.TestRunEvent, {
                runId,
                event: {
                    type: 'finished',
                    testName: 'T/testFail',
                    testFile: '/test.m',
                    status: 'failed',
                    duration: 0.3,
                    diagnostics: [{
                        message: 'Verification failed: 1+1 is not equal to 3',
                        failedInFile: '/src/TestClass.m',
                        failedOnLine: 15,
                        stack: [{ file: '/src/TestClass.m', name: 'testFail', line: 15 }]
                    }]
                }
            })

            sinon.assert.calledOnce(mockRun.failed)
            const failedCall = mockRun.failed.firstCall
            assert.strictEqual(failedCall.args[0], item)

            const messages = failedCall.args[1]
            assert.strictEqual(messages.length, 1)
            assert.strictEqual(messages[0].message, 'Verification failed: 1+1 is not equal to 3')
            assert.ok(messages[0].location)
            assert.strictEqual(messages[0].location.uri.fsPath, '/src/TestClass.m')
            assert.strictEqual(messages[0].location.range.line, 14) // 0-indexed
        })

        it('should show all diagnostics when a single test has multiple failures', async () => {
            const item = addTestItemToController(controller, 'T/testMulti', 'testMulti', '/test.m')

            const request = new vscode.TestRunRequest([item])
            const tokenSource = new vscode.CancellationTokenSource()
            await runHandler(request, tokenSource.token)

            const runId = mockClient.sendNotification.firstCall.args[1].runId

            mockClient._trigger(Notification.TestRunEvent, {
                runId,
                event: {
                    type: 'finished',
                    testName: 'T/testMulti',
                    testFile: '/test.m',
                    status: 'failed',
                    duration: 0.5,
                    diagnostics: [
                        { message: 'First assertion failed', failedInFile: '/test.m', failedOnLine: 10, stack: [] },
                        { message: 'Second assertion failed', failedInFile: '/test.m', failedOnLine: 12, stack: [] },
                        { message: 'Third assertion failed', failedInFile: '/test.m', failedOnLine: 14, stack: [] }
                    ]
                }
            })

            sinon.assert.calledOnce(mockRun.failed)
            const messages = mockRun.failed.firstCall.args[1]
            assert.strictEqual(messages.length, 3)
            assert.strictEqual(messages[0].message, 'First assertion failed')
            assert.strictEqual(messages[1].message, 'Second assertion failed')
            assert.strictEqual(messages[2].message, 'Third assertion failed')
        })

        it('should report incomplete tests as skipped (not errored)', async () => {
            const item = addTestItemToController(controller, 'T/testError', 'testError', '/test.m')

            const request = new vscode.TestRunRequest([item])
            const tokenSource = new vscode.CancellationTokenSource()
            await runHandler(request, tokenSource.token)

            const runId = mockClient.sendNotification.firstCall.args[1].runId

            // Incomplete with a real diagnostic (not just 'Test failed') -> errored
            mockClient._trigger(Notification.TestRunEvent, {
                runId,
                event: {
                    type: 'finished',
                    testName: 'T/testError',
                    testFile: '/test.m',
                    status: 'incomplete',
                    duration: 0.1,
                    diagnostics: [{
                        message: 'Error using foo\nUndefined function or variable "x"',
                        failedInFile: '/src/foo.m',
                        failedOnLine: 7,
                        stack: [{ file: '/src/foo.m', name: 'foo', line: 7 }]
                    }]
                }
            })

            sinon.assert.calledOnce(mockRun.skipped)
            assert.strictEqual(mockRun.errored.callCount, 0)
        })

        it('should set correct location for navigation with nested stack frames', async () => {
            const item = addTestItemToController(controller, 'T/testNested', 'testNested', '/test.m')

            const request = new vscode.TestRunRequest([item])
            const tokenSource = new vscode.CancellationTokenSource()
            await runHandler(request, tokenSource.token)

            const runId = mockClient.sendNotification.firstCall.args[1].runId

            mockClient._trigger(Notification.TestRunEvent, {
                runId,
                event: {
                    type: 'finished',
                    testName: 'T/testNested',
                    testFile: '/test.m',
                    status: 'failed',
                    duration: 0.2,
                    diagnostics: [{
                        message: 'Assertion failed in helper',
                        failedInFile: '/src/helpers/validateInput.m',
                        failedOnLine: 23,
                        stack: [
                            { file: '/src/helpers/validateInput.m', name: 'validateInput', line: 23 },
                            { file: '/src/TestClass.m', name: 'testNested', line: 45 },
                            { file: '/src/TestClass.m', name: 'setup', line: 10 }
                        ]
                    }]
                }
            })

            sinon.assert.calledOnce(mockRun.failed)
            const message = mockRun.failed.firstCall.args[1][0]

            // Location should point to failedInFile/failedOnLine (top of stack)
            assert.strictEqual(message.location.uri.fsPath, '/src/helpers/validateInput.m')
            assert.strictEqual(message.location.range.line, 22) // 0-indexed (23 - 1)
        })

    })

    describe('Cancellation', () => {
        it('should interrupt running tests via mvm.interrupt() when cancelled', async () => {
            const item = addTestItemToController(controller, 'T/testLong', 'testLong', '/test.m')

            const request = new vscode.TestRunRequest([item])
            const tokenSource = new vscode.CancellationTokenSource()
            await runHandler(request, tokenSource.token)

            // Verify interrupt not called yet
            sinon.assert.notCalled(mockMvm.interrupt)

            // Cancel
            tokenSource.cancel()

            sinon.assert.calledOnce(mockMvm.interrupt)
        })

        it('should preserve partial results from completed tests after cancel', async () => {
            const item1 = addTestItemToController(controller, 'T/test1', 'test1', '/test.m')
            const item2 = addTestItemToController(controller, 'T/test2', 'test2', '/test.m')
            const item3 = addTestItemToController(controller, 'T/test3', 'test3', '/test.m')

            const request = new vscode.TestRunRequest([item1, item2, item3])
            const tokenSource = new vscode.CancellationTokenSource()
            await runHandler(request, tokenSource.token)

            const runId = mockClient.sendNotification.firstCall.args[1].runId

            // First test completes successfully
            mockClient._trigger(Notification.TestRunEvent, {
                runId,
                event: { type: 'finished', testName: 'T/test1', testFile: '/test.m', status: 'passed', duration: 0.1 }
            })

            // Second test starts
            mockClient._trigger(Notification.TestRunEvent, {
                runId,
                event: { type: 'started', testName: 'T/test2', testFile: '/test.m' }
            })

            // Cancel mid-run
            tokenSource.cancel()

            // Verify first test result is preserved
            sinon.assert.calledOnce(mockRun.passed)
            sinon.assert.calledWith(mockRun.passed, item1)

            // Complete the run (server sends complete after interrupt)
            mockClient._trigger(Notification.TestRunComplete, { runId })

            sinon.assert.calledOnce(mockRun.end)
            // Passed result from test1 is still recorded
            assert.strictEqual(mockRun.passed.callCount, 1)
        })
    })
})
