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
        isDebugging: sinon.stub().returns(false),
        isBusy: sinon.stub().returns(false),
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
        refreshHandler: undefined as any,
        dispose: sinon.stub()
    }
}

// Records the callbacks registered on each created FileSystemWatcher, keyed by its pattern.
interface WatcherRecord {
    pattern: any
    onCreate: Array<(uri: any) => void>
    onChange: Array<(uri: any) => void>
    onDelete: Array<(uri: any) => void>
}

function setupFileSystemWatcherMock (): WatcherRecord[] {
    const records: WatcherRecord[] = []
    ;(vscode.workspace as any).createFileSystemWatcher = sinon.stub().callsFake((pattern: any) => {
        const rec: WatcherRecord = { pattern, onCreate: [], onChange: [], onDelete: [] }
        records.push(rec)
        return {
            onDidCreate: (cb: (uri: any) => void) => { rec.onCreate.push(cb); return new vscode.Disposable(() => {}) },
            onDidDelete: (cb: (uri: any) => void) => { rec.onDelete.push(cb); return new vscode.Disposable(() => {}) },
            onDidChange: (cb: (uri: any) => void) => { rec.onChange.push(cb); return new vscode.Disposable(() => {}) },
            dispose: () => {}
        }
    })
    return records
}

function folderWatcher (records: WatcherRecord[]): WatcherRecord | undefined {
    return records.find(r => r.pattern.pattern === '**/*.m')
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
    let watchers: WatcherRecord[]
    let clock: sinon.SinonFakeTimers

    before(async () => {
        MatlabTestDiscovery = await importDiscovery()
    })

    beforeEach(() => {
        vscode._resetConfigListeners()
        vscode._state.autoDiscoverSetting = true
        mockMvm = createMockMvm('connected')
        mockContext = createMockContext()
        mockTelemetry = createMockTelemetryLogger()
        controller = createMockController()
        watchers = setupFileSystemWatcherMock()
    })

    afterEach(() => {
        sinon.restore()
        if (clock) {
            clock.restore()
        }
    })

    function construct (): any {
        return new MatlabTestDiscovery(controller, mockMvm, mockContext, mockTelemetry)
    }

    describe('FileSystemWatcher (W1)', () => {
        it('should re-discover when a known test file changes', async () => {
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests']

            const discovery = construct()
            await discovery.discoverAll()
            mockMvm.feval.resetHistory()

            clock = sinon.useFakeTimers()

            const folder = folderWatcher(watchers)
            assert.ok(folder != null && folder.onChange.length > 0, 'folder change listener should be registered')
            folder!.onChange[0](vscode.Uri.file('/test/TestA.m'))

            clock.tick(2100)
            await Promise.resolve()

            sinon.assert.called(mockMvm.feval)
        })

        it('should NOT re-discover when a non-test .m file changes', async () => {
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests']

            const discovery = construct()
            await discovery.discoverAll()
            mockMvm.feval.resetHistory()

            clock = sinon.useFakeTimers()

            const folder = folderWatcher(watchers)
            folder!.onChange[0](vscode.Uri.file('/workspace/tests/helperFunction.m'))

            clock.tick(2100)
            await Promise.resolve()

            sinon.assert.notCalled(mockMvm.feval)
        })

        it('should not wire onDidCreate for folder watchers', () => {
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests']

            construct()

            const folder = folderWatcher(watchers)
            assert.ok(folder != null, 'expected a folder watcher')
            assert.strictEqual(folder!.onCreate.length, 0, 'folder watcher must ignore file creation')
            assert.strictEqual(folder!.onChange.length, 1, 'folder watcher should watch changes')
            assert.strictEqual(folder!.onDelete.length, 1, 'folder watcher should watch deletions')
        })

        it('should wire onDidCreate for individually-added file sources', () => {
            mockContext._state['matlab.testing.files'] = ['/external/StandaloneTest.m']

            construct()

            const fileWatch = watchers.find(r => r.pattern.pattern === 'StandaloneTest.m')
            assert.ok(fileWatch != null, 'expected a file-source watcher')
            assert.strictEqual(fileWatch!.onCreate.length, 1, 'file source watches creation')
            assert.strictEqual(fileWatch!.onChange.length, 1)
            assert.strictEqual(fileWatch!.onDelete.length, 1)
        })

        it('should create a RelativePattern watcher for each registered test source', () => {
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests', '/external/suite']
            mockContext._state['matlab.testing.files'] = ['/external/StandaloneTest.m']

            construct()

            const createFSW = vscode.workspace.createFileSystemWatcher as sinon.SinonStub
            sinon.assert.calledThrice(createFSW)

            const patterns = watchers.map(r => r.pattern)
            patterns.forEach(p => assert.ok(p instanceof vscode.RelativePattern, 'expected a RelativePattern'))

            const folderWatch = patterns.find(p => p.base === '/workspace/tests')
            assert.ok(folderWatch != null, 'expected a watcher for the registered folder')
            assert.strictEqual(folderWatch.pattern, '**/*.m', 'folders are watched recursively')

            const fileWatch = patterns.find(p => p.base === '/external')
            assert.ok(fileWatch != null, 'expected a watcher based on the file\'s directory')
            assert.strictEqual(fileWatch.pattern, 'StandaloneTest.m', 'files are watched by exact name')
        })

        it('should debounce re-discovery (2000ms) to avoid excessive calls', async () => {
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests']

            const discovery = construct()
            await discovery.discoverAll()
            mockMvm.feval.resetHistory()

            clock = sinon.useFakeTimers()

            const folder = folderWatcher(watchers)
            const knownFile = vscode.Uri.file('/test/TestA.m')

            folder!.onChange[0](knownFile)
            clock.tick(500)
            folder!.onChange[0](knownFile)
            clock.tick(500)
            folder!.onChange[0](knownFile)
            clock.tick(500)

            // Only 1000ms since the last change — below the 2000ms threshold.
            assert.strictEqual(mockMvm.feval.callCount, 0)

            clock.tick(2100)
            await Promise.resolve()

            sinon.assert.calledOnce(mockMvm.feval)
        })
    })

    describe('autoDiscover setting', () => {
        it('should not discover on connect when auto-discovery is off', () => {
            vscode._state.autoDiscoverSetting = false
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests']

            construct()
            mockMvm.emit('stateChanged', 'disconnected', 'connected')

            sinon.assert.notCalled(mockMvm.feval)
        })

        it('should not register file watchers when auto-discovery is off', () => {
            vscode._state.autoDiscoverSetting = false
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests']

            construct()

            sinon.assert.notCalled(vscode.workspace.createFileSystemWatcher as sinon.SinonStub)
        })

        it('should still discover via the manual refresh path when auto-discovery is off', async () => {
            vscode._state.autoDiscoverSetting = false
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests']

            const discovery = construct()
            await discovery.discoverAll()

            sinon.assert.called(mockMvm.feval)
        })

        it('should re-register watchers when the setting is toggled back on', () => {
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests']

            construct()
            const createFSW = vscode.workspace.createFileSystemWatcher as sinon.SinonStub
            sinon.assert.calledOnce(createFSW)

            vscode._state.autoDiscoverSetting = false
            vscode._fireConfigChange('MATLAB.discoverTestsAutomatically')
            createFSW.resetHistory()

            vscode._state.autoDiscoverSetting = true
            vscode._fireConfigChange('MATLAB.discoverTestsAutomatically')

            sinon.assert.calledOnce(createFSW)
        })
    })

    describe('cancellation', () => {
        it('should interrupt MATLAB and skip the tree rebuild when cancelled', async () => {
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests']

            let resolveFeval: (value: any) => void = () => {}
            mockMvm.feval = sinon.stub().returns(new Promise(resolve => { resolveFeval = resolve }))

            const discovery = construct()

            const source = new vscode.CancellationTokenSource()
            const done = discovery.discoverAll(source.token)

            source.cancel()
            sinon.assert.called(mockMvm.interrupt)

            resolveFeval({
                result: [{ names: ['TestA/testMethod1'], filenames: ['/test/TestA.m'], procedureNames: ['testMethod1'], testParentNames: ['TestA'], parameterizations: [''], error: '' }]
            })
            await done

            assert.strictEqual(controller.items.get('/test/TestA.m'), undefined, 'tree must not be rebuilt after cancel')
        })
    })

    describe('busy/debug guard', () => {
        it('should defer automatic discovery while MATLAB is busy, then run when idle', async () => {
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests']
            mockMvm.isBusy.returns(true)

            construct()
            mockMvm.emit('stateChanged', 'disconnected', 'connected')

            sinon.assert.notCalled(mockMvm.feval)

            mockMvm.isBusy.returns(false)
            mockMvm.emit('promptChange', '', true)
            await Promise.resolve()

            sinon.assert.called(mockMvm.feval)
        })

        it('should honor a manual refresh even while MATLAB is busy', async () => {
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests']
            mockMvm.isBusy.returns(true)

            const discovery = construct()
            await discovery.discoverAll()

            sinon.assert.called(mockMvm.feval)
        })
    })

    describe('clearAllTestSources', () => {
        it('should clear all sources, state keys, and the tree after confirmation', async () => {
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests']
            mockContext._state['matlab.testing.files'] = ['/external/StandaloneTest.m']
            mockContext._state['matlab.testing.excludedFiles'] = ['/workspace/tests/Ignored.m']

            const discovery = construct()
            await discovery.discoverAll()

            sinon.stub(vscode.window, 'showWarningMessage').resolves('Clear All Tests')
            await discovery.clearAllTestSources()

            assert.deepStrictEqual(mockContext._state['matlab.testing.folders'], [])
            assert.deepStrictEqual(mockContext._state['matlab.testing.files'], [])
            assert.deepStrictEqual(mockContext._state['matlab.testing.excludedFiles'], [])
            assert.strictEqual(controller.items.size, 0, 'tree should be empty')
        })

        it('should do nothing when the confirmation is dismissed', async () => {
            mockContext._state['matlab.testing.folders'] = ['/workspace/tests']

            const discovery = construct()
            sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined)
            await discovery.clearAllTestSources()

            assert.deepStrictEqual(mockContext._state['matlab.testing.folders'], ['/workspace/tests'], 'sources should be untouched')
        })
    })
})
