// Copyright 2026 The MathWorks, Inc.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-empty-function, @typescript-eslint/no-explicit-any */

/**
 * Minimal mock of the 'vscode' module for unit testing CommandWindow.
 * Must be registered before importing CommandWindow.
 */

class MockEventEmitter<T> {
    private _listeners: Array<(e: T) => void> = [];

    event = (listener: (e: T) => void): { dispose: () => void } => {
        this._listeners.push(listener);
        return { dispose: () => {} };
    };

    fire (data: T): void {
        for (const l of this._listeners) l(data);
    }

    dispose (): void {
        this._listeners = [];
    }
}

class MockDisposable {
    dispose (): void {}
}

const mockVscode = {
    EventEmitter: MockEventEmitter,
    Disposable: MockDisposable,
    commands: {
        executeCommand: (..._args: unknown[]) => Promise.resolve()
    },
    window: {
        onDidOpenTerminal: () => ({ dispose: () => {} }),
        onDidCloseTerminal: () => ({ dispose: () => {} }),
        onDidChangeActiveTerminal: () => ({ dispose: () => {} }),
        createTerminal: () => ({}),
        registerTerminalProfileProvider: () => ({ dispose: () => {} })
    },
    workspace: {
        getConfiguration: () => ({
            get: () => [],
            update: () => Promise.resolve()
        })
    },
    env: {
        clipboard: {
            readText: () => Promise.resolve(''),
            writeText: () => Promise.resolve()
        }
    }
};

export function registerMockVscode (): void {
    // Inject 'vscode' into Node's module cache without resolving it on disk
    const Module = require('module');
    const originalResolveFilename = Module._resolveFilename;
    Module._resolveFilename = function (request: string, ...args: any[]) {
        if (request === 'vscode') {
            return 'vscode'; // Return a fake path
        }
        return originalResolveFilename.call(this, request, ...args);
    };

    require.cache.vscode = {
        id: 'vscode',
        filename: 'vscode',
        loaded: true,
        exports: mockVscode,
        children: [],
        paths: [],
        path: '',
        isPreloading: false,
        require: require
    } as any;
}
