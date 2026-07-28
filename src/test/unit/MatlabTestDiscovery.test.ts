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

// --- Mock Factories ---

function createMockMvm (state = 'connected'): any {
    const emitter = new EventEmitter()
    const mvm = Object.assign(emitter, {
        getMatlabState: sinon.stub().returns(state),
        feval: sinon.stub().resolves({
            result: [{
                names: ['TestA/testMethod1'],
                filenames: ['/test/TestA.m'],
                procedureNames: ['testMethod1'],
                testParentNames: ['TestA'],
                parameterizations: [''],
                error: ''
            }]
        }),
        interrupt: sinon.stub()
    })
    const originalOn = emitter.on.bind(emitter)
    ;(mvm as any).on = (event: string, listener: (...args: any[]) => void) => {
        originalOn(event, listener)
        return new vscode.Disposable(() => emitter.removeListener(event, listener))
    }
    return mvm
}

function createMockContext (): any {
    const state: Record<string, any> = {}
    return {
        workspaceState: {
            get: sinon.stub().callsFake((key: string, defaultValue?: any) => {
                return state[key] ?? defaultValue
            }),
            update: sinon.stub().callsFake((key: string, value: any) => {
                state[key] = value
                return Promise.resolve()
            })
        },
        _state: state
    }
}

function createMockTelemetryLogger (): any {
    return { logEvent: sinon.stub() }
}

function createMockController (): any {
    const items = vscode.createMockTestItemCollection()
    return {
        items,
        createTestItem: (id: string, label: string, uri?: any) => vscode.createMockTestItem(id, label, uri),
        resolveHandler: undefined as any,
        dispose: sinon.stub()
    }
}

// Track FileSystemWatcher callbacks
interface WatcherCallbacks {
    onCreate: Array<() => void>
    onDelete: Array<() => void>
    onChange: Array<() => void>
}

function setupFileSystemWatcherMock (): WatcherCallbacks {
    const callbacks: WatcherCallbacks = { onCreate: [], onDelete: [], onChange: [] }
    const originalCreateFSW = vscode.workspace.createFileSystemWatcher
    ;(vscode.workspace as any).createFileSystemWatcher = sinon.stub().callsFake((_pattern: string) => {
        return {
            onDidCreate: (cb: () => void) => { callbacks.onCreate.push(cb); return new vscode.Disposable(() => {}) },
            onDidDelete: (cb: () => void) => { callbacks.onDelete.push(cb); return new vscode.Disposable(() => {}) },
            onDidChange: (cb: () => void) => { callbacks.onChange.push(cb); return new vscode.Disposable(() => {}) },
            dispose: () => {}
        }
    })
    return callbacks
}

/** Imports MatlabTestDiscovery with the mocked vscode module. */
async function importDiscovery (): Promise<any> {
    const mod = await import('../../services/testing/MatlabTestDiscovery')
    return mod.default
}

// --- Tests ---

describe('MatlabTestDiscovery', () => {
    let MatlabTestDiscovery: any
    let mockMvm: any
    let mockContext: any
    let mockTelemetry: any
    let controller: any
    let watcherCallbacks: WatcherCallbacks
    let clock: sinon.SinonFakeTimers

    before(async () => {
        MatlabTestDiscovery = await importDiscovery()
    })

    beforeEach(() => {
        mockMvm = createMockMvm('connected')
        mockContext = createMockContext()
        mockTelemetry = createMockTelemetryLogger()
        controller = createMockController()
        watcherCallbacks = setupFileSystemWatcherMock()
    })

    afterEach(() => {
        sinon.restore()
        if (clock) {
            clock.restore()
        }
    })

    describe('FileSystemWatcher', () => {
        it('should trigger re-discovery when .m file is modified', async () => {
            // Pre-populate workspace state with a test folder so discovery has sources
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests']

            const discovery = new MatlabTestDiscovery(controller, mockMvm, mockContext, mockTelemetry)

            // Reset feval call count from constructor's initial discovery
            mockMvm.feval.resetHistory()

            // Install fake timers to control debounce
            clock = sinon.useFakeTimers()

            // Simulate .m file change
            assert.ok(watcherCallbacks.onChange.length > 0, 'onChange listener should be registered')
            watcherCallbacks.onChange[0]()

            // Advance past the 500ms debounce
            clock.tick(600)

            // Allow async discoverAll to proceed
            await Promise.resolve()

            sinon.assert.called(mockMvm.feval)
        })

        it('should create a RelativePattern watcher for each registered test source', () => {
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests', '/external/suite']
            mockContext._state['matlab.testing.files'] = ['/external/StandaloneTest.m']

            new MatlabTestDiscovery(controller, mockMvm, mockContext, mockTelemetry)

            const createFSW = vscode.workspace.createFileSystemWatcher as sinon.SinonStub
            // One watcher per registered source (2 folders + 1 file).
            sinon.assert.calledThrice(createFSW)

            const patterns = createFSW.getCalls().map(c => c.args[0])
            patterns.forEach(p => assert.ok(p instanceof vscode.RelativePattern, 'expected a RelativePattern'))

            const folderWatch = patterns.find(p => p.base === '/workspace/tests')
            assert.ok(folderWatch != null, 'expected a watcher for the registered folder')
            assert.strictEqual(folderWatch.pattern, '**/*.m', 'folders are watched recursively')

            const fileWatch = patterns.find(p => p.base === '/external')
            assert.ok(fileWatch != null, 'expected a watcher based on the file\'s directory')
            assert.strictEqual(fileWatch.pattern, 'StandaloneTest.m', 'files are watched by exact name')
        })

        it('should recreate watchers when a test source is added or removed', async () => {
            const discovery = new MatlabTestDiscovery(controller, mockMvm, mockContext, mockTelemetry)
            const createFSW = vscode.workspace.createFileSystemWatcher as sinon.SinonStub

            // No sources registered at construction -> no watchers created.
            sinon.assert.notCalled(createFSW)

            sinon.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file('/external/suite')])
            await discovery.addTestFolder()

            // Adding a source spins up a watcher for it.
            sinon.assert.calledOnce(createFSW)
            assert.ok(createFSW.getCall(0).args[0] instanceof vscode.RelativePattern)
        })

        it('should debounce re-discovery (500ms) to avoid excessive calls', async () => {
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests']

            const discovery = new MatlabTestDiscovery(controller, mockMvm, mockContext, mockTelemetry)
            mockMvm.feval.resetHistory()

            clock = sinon.useFakeTimers()

            // Rapid file changes (simulating save-all or formatter)
            watcherCallbacks.onChange[0]()
            clock.tick(100)
            watcherCallbacks.onChange[0]()
            clock.tick(100)
            watcherCallbacks.onChange[0]()
            clock.tick(100)
            watcherCallbacks.onChange[0]()
            clock.tick(100)
            watcherCallbacks.onChange[0]()

            // Only 400ms elapsed since last change — should NOT have discovered yet
            assert.strictEqual(mockMvm.feval.callCount, 0)

            // Advance past debounce threshold (500ms from last change)
            clock.tick(600)
            await Promise.resolve()

            // Should trigger exactly one discovery
            sinon.assert.calledOnce(mockMvm.feval)
        })
    })
})
