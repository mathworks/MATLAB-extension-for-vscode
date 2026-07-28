// Copyright 2026 The MathWorks, Inc.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

/**
 * Registers the unified vscode mock into Node's module cache.
 * Must be called before importing any module that depends on 'vscode'.
 */

const mockVscode = require('./mocks/vscode')

export function registerMockVscode (): void {
    const Module = require('module');
    const originalResolveFilename = Module._resolveFilename;
    Module._resolveFilename = function (request: string, ...args: any[]) {
        if (request === 'vscode') {
            return 'vscode';
        }
        return originalResolveFilename.call(this, request, ...args);
    };

    (require as any).cache.vscode = {
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
