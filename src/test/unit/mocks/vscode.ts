// Copyright 2026 The MathWorks, Inc.
// Unified mock of the 'vscode' module for all unit tests.

/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-explicit-any */

export class Disposable {
    private readonly callOnDispose: () => void
    constructor (callOnDispose: () => void = () => {}) {
        this.callOnDispose = callOnDispose
    }

    dispose (): void {
        this.callOnDispose()
    }
}

export class EventEmitter<T> {
    private _listeners: Array<(e: T) => void> = []

    event = (listener: (e: T) => void): { dispose: () => void } => {
        this._listeners.push(listener)
        return { dispose: () => {} }
    }

    fire (data: T): void {
        for (const l of this._listeners) l(data)
    }

    dispose (): void {
        this._listeners = []
    }
}

export class Uri {
    readonly fsPath: string
    readonly scheme: string

    private constructor (fsPath: string) {
        this.fsPath = fsPath
        this.scheme = 'file'
    }

    static file (path: string): Uri {
        return new Uri(path)
    }

    toString (): string {
        return `file://${this.fsPath}`
    }
}

export class RelativePattern {
    readonly baseUri: Uri
    readonly base: string

    constructor (base: Uri | string, public readonly pattern: string) {
        if (typeof base === 'string') {
            this.base = base
            this.baseUri = Uri.file(base)
        } else {
            this.baseUri = base
            this.base = base.fsPath
        }
    }
}

export class Position {
    constructor (public readonly line: number, public readonly character: number) {}
}

export class Range {
    constructor (
        public readonly startLine: number,
        public readonly startCharacter: number,
        public readonly endLine: number,
        public readonly endCharacter: number
    ) {}
}

export class Location {
    constructor (public readonly uri: Uri, public readonly range: Position | Range) {}
}

export class TestMessage {
    public location?: Location

    constructor (public readonly message: string) {}

    static diff (message: string, _expected: string, _actual: string): TestMessage {
        return new TestMessage(message)
    }
}

export class CancellationTokenSource {
    private _listeners: Array<() => void> = []
    private _isCancelled = false

    token = {
        isCancellationRequested: false,
        onCancellationRequested: (listener: () => void) => {
            this._listeners.push(listener)
            return new Disposable(() => {})
        }
    }

    cancel (): void {
        this._isCancelled = true
        this.token.isCancellationRequested = true
        this._listeners.forEach(l => l())
    }

    dispose (): void {}
}

export enum TestRunProfileKind {
    Run = 1,
    Debug = 2,
    Coverage = 3
}

// Mutable state for tests that need to control vscode.env / workspace.getConfiguration
export const _state = {
    isTelemetryEnabled: true,
    sessionId: 'test-session-id',
    telemetrySetting: true as boolean | undefined
}

export const env = {
    get isTelemetryEnabled () { return _state.isTelemetryEnabled },
    get sessionId () { return _state.sessionId },
    clipboard: {
        readText: async () => '',
        writeText: async () => {}
    }
}

export const window = {
    showWarningMessage: async (_msg: string) => undefined,
    showErrorMessage: async (_msg: string) => undefined,
    showInformationMessage: async (_msg: string) => undefined,
    showOpenDialog: async (_options: any) => undefined,
    onDidOpenTerminal: () => ({ dispose: () => {} }),
    onDidCloseTerminal: () => ({ dispose: () => {} }),
    onDidChangeActiveTerminal: () => ({ dispose: () => {} }),
    createTerminal: () => ({}),
    registerTerminalProfileProvider: () => ({ dispose: () => {} })
}

export const workspace = {
    createFileSystemWatcher: (_pattern: string) => {
        const watcher: any = {
            onDidCreate: (_cb: () => void) => new Disposable(() => {}),
            onDidDelete: (_cb: () => void) => new Disposable(() => {}),
            onDidChange: (_cb: () => void) => new Disposable(() => {}),
            dispose: () => {}
        }
        return watcher
    },
    getConfiguration: (_section?: string) => ({
        get: (_key: string) => _state.telemetrySetting,
        update: () => Promise.resolve()
    }),
    workspaceFolders: undefined as any
}

export const tests = {
    createTestController: (_id: string, _label: string) => createMockTestController()
}

export const commands = {
    registerCommand: (_command: string, _callback: (...args: any[]) => any) => new Disposable(() => {}),
    executeCommand: async (_command: string, ..._args: any[]) => undefined
}

export function createMockTestController (): any {
    const items = createMockTestItemCollection()
    return {
        items,
        createTestItem: (id: string, label: string, uri?: Uri) => createMockTestItem(id, label, uri),
        createRunProfile: (_label: string, _kind: TestRunProfileKind, handler: any) => {
            return { runHandler: handler, dispose: () => {} }
        },
        createTestRun: (_request: any) => createMockTestRun(),
        resolveHandler: undefined as any,
        dispose: () => {}
    }
}

export function createMockTestRun (): any {
    return {
        enqueued: () => {},
        started: () => {},
        passed: () => {},
        failed: () => {},
        errored: () => {},
        skipped: () => {},
        end: () => {}
    }
}

export function createMockTestItem (id: string, label: string, uri?: Uri): any {
    const children = createMockTestItemCollection()
    return {
        id,
        label,
        uri,
        range: undefined as any,
        canResolveChildren: false,
        children,
        parent: undefined as any
    }
}

export function createMockTestItemCollection (): any {
    const map = new Map<string, any>()
    return {
        get: (id: string) => map.get(id),
        add: (item: any) => map.set(item.id, item),
        delete: (id: string) => map.delete(id),
        replace: (items: any[]) => {
            map.clear()
            items.forEach((item: any) => map.set(item.id, item))
        },
        forEach: (cb: (item: any) => void) => map.forEach(cb),
        get size () { return map.size }
    }
}

export class TestRunRequest {
    constructor (
        public readonly include?: any[],
        public readonly exclude?: any[],
        public readonly profile?: any
    ) {}
}
