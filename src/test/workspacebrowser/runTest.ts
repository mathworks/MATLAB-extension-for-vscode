// Copyright 2026 The MathWorks, Inc.

// Test runner that bootstraps a jsdom environment for workspace browser tests.
// Mocks the vscode module, browser globals, and VS Code webview API so that
// both extension-side and webview-side code can be tested in Node.js.

import * as path from 'path'
import { JSDOM } from 'jsdom'
import * as Mocha from 'mocha'
import * as glob from 'glob'
import mock = require('mock-require')

// ── Mock vscode module ──────────────────────────────────────────
// Must be registered before any imports that depend on it.
// Individual tests override specific APIs via sinon stubs.
mock('vscode', {
    window: {
        onDidChangeActiveColorTheme: () => ({ dispose: () => {} }),
        createStatusBarItem: () => ({}),
        showInformationMessage: () => Promise.resolve(undefined),
        showWarningMessage: () => Promise.resolve(undefined),
        showErrorMessage: () => Promise.resolve(undefined),
        registerWebviewViewProvider: () => ({ dispose: () => {} })
    },
    workspace: {
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        getConfiguration: () => ({
            get: (_key: string, defaultValue: unknown) => defaultValue
        })
    },
    commands: {
        registerCommand: () => ({ dispose: () => {} }),
        executeCommand: () => Promise.resolve()
    },
    Uri: {
        joinPath: (...args: unknown[]) => ({ toString: () => args.join('/') })
    },
    Disposable: class { dispose (): void {} }
})

// ── Browser globals via jsdom ───────────────────────────────────
// Provides document, window, HTMLElement, and event constructors
// needed by webview.ts DOM operations.

interface BrowserGlobal {
    window: unknown
    document: Document
    customElements: CustomElementRegistry
    HTMLElement: typeof HTMLElement
}

declare const global: BrowserGlobal

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true
})

;(global as unknown as BrowserGlobal).window = dom.window
;(global as unknown as BrowserGlobal).document = dom.window.document
;(global as unknown as BrowserGlobal).customElements = dom.window.customElements
;(global as unknown as BrowserGlobal).HTMLElement = dom.window.HTMLElement
;(global as unknown as Record<string, unknown>).MouseEvent = dom.window.MouseEvent
;(global as unknown as Record<string, unknown>).KeyboardEvent = dom.window.KeyboardEvent
;(global as unknown as Record<string, unknown>).Event = dom.window.Event
;(global as unknown as Record<string, unknown>).MessageEvent = dom.window.MessageEvent

// Mock acquireVsCodeApi — production code calls this to get the postMessage API
;(global as unknown as Record<string, unknown>).acquireVsCodeApi = () => ({
    postMessage: () => {}
})

// Set iconsBaseUri on the body element — the webview reads it from document.body.dataset
document.body.setAttribute('data-icons-base-uri', 'test://icons')

// CSS.escape is not implemented in jsdom — provide a basic polyfill
if (typeof (global as unknown as Record<string, unknown>).CSS === 'undefined') {
    (global as unknown as Record<string, unknown>).CSS = {}
}
(global as unknown as Record<string, { escape: (s: string) => string }>).CSS.escape =
    (s: string) => s.replace(/([^\w-])/g, '\\$1')

// requestAnimationFrame is not available in Node.js
;(global as unknown as Record<string, unknown>).requestAnimationFrame = (callback: FrameRequestCallback) => {
    return setTimeout(callback, 16)
}

// ── Run Mocha ───────────────────────────────────────────────────

async function runTests (): Promise<void> {
    // chai v5 is ESM-only — pre-load via dynamic import and inject into
    // the require cache so compiled CommonJS test files can require() it.
    // new Function prevents TypeScript from compiling import() to require().
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<unknown>
    const chaiModule = await dynamicImport('chai')
    const chaiPath = require.resolve('chai')
    require.cache[chaiPath] = {
        id: chaiPath,
        filename: chaiPath,
        loaded: true,
        exports: chaiModule,
        children: [],
        paths: [],
        path: path.dirname(chaiPath),
        isPreloading: false,
        require
    } as unknown as NodeModule

    const mocha = new Mocha({
        ui: 'tdd',
        reporter: 'spec'
    })

    // Discover all test files recursively under this directory
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
