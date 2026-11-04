// Copyright 2026 The MathWorks, Inc.
// Mimics NODE_V8_COVERAGE for Chromium webview scripts.

import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
import type { Profiler } from 'inspector'
import fetch from 'node-fetch'
import WebSocket = require('ws')
import { VSBrowser } from 'vscode-extension-tester'

interface ProtocolResult {
    result?: Profiler.ScriptCoverage[]
}

interface ProtocolMessage {
    id?: number
    method?: string
    result?: ProtocolResult
    error?: { message: string }
    params?: {
        sessionId: string
        targetInfo: { type: string }
        result: Profiler.ScriptCoverage[]
    }
}

interface PendingCommand {
    sessionId?: string
    resolve: (result: ProtocolResult) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
}

// Collects V8 coverage from VS Code webviews through Chromium's DevTools Protocol.
class ChromiumCoverage {
    private socket?: WebSocket
    private nextId = 0
    private readonly pending = new Map<number, PendingCommand>()
    private readonly sessions = new Map<string, Promise<void>>()
    private failure?: Error

    async start (): Promise<void> {
        // no-op when the test run is not collecting coverage.
        if (process.env.NODE_V8_COVERAGE === undefined) return

        // WebDriver exposes the address of VS Code's Chromium debugger.
        const capabilities = await VSBrowser.instance.driver.getCapabilities()
        const options = capabilities.get('goog:chromeOptions') as { debuggerAddress: string }
        const response = await fetch(`http://${options.debuggerAddress}/json/version`)
        const { webSocketDebuggerUrl } = await response.json() as { webSocketDebuggerUrl: string }
        const socket = new WebSocket(webSocketDebuggerUrl)
        this.socket = socket
        socket.on('message', data => this.onMessage(JSON.parse((data as Buffer).toString('utf8')) as ProtocolMessage))
        socket.on('error', error => { this.failure = error })
        await new Promise<void>((resolve, reject) => {
            socket.once('open', resolve)
            socket.once('error', reject)
        })

        // Attach before webview scripts execute, including out-of-process iframes.
        await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
        await Promise.all(this.sessions.values())
    }

    private onMessage (message: ProtocolMessage): void {
        // Responses to these messages complete a command previously sent by this instance.
        if (message.id !== undefined) {
            const command = this.pending.get(message.id)
            if (command === undefined) return
            clearTimeout(command.timeout)
            this.pending.delete(message.id)
            // Chromium can reject a closed session before its detach event arrives.
            if (command.sessionId !== undefined && message.error?.message === 'Session with given id not found.') {
                this.detach(command.sessionId)
            }
            if (message.error !== undefined) command.reject(new Error(message.error.message))
            else command.resolve(message.result ?? {})
            return
        }

        const params = message.params
        if (params === undefined) return
        // These messages report webview lifecycle events and incremental coverage.
        if (message.method === 'Target.attachedToTarget') {
            const ready = this.attach(params.sessionId, params.targetInfo.type).catch(error => {
                if (this.sessions.has(params.sessionId)) this.failure = error as Error
            })
            this.sessions.set(params.sessionId, ready)
        } else if (message.method === 'Target.detachedFromTarget') {
            this.detach(params.sessionId)
        } else if (message.method === 'Profiler.preciseCoverageDeltaUpdate') {
            this.save(params.result)
        }
    }

    private detach (sessionId: string): void {
        // The target cannot reply after it closes, so fail its pending commands.
        this.sessions.delete(sessionId)
        for (const [id, command] of this.pending) {
            if (command.sessionId !== sessionId) continue
            clearTimeout(command.timeout)
            this.pending.delete(id)
            command.reject(new Error('Chromium target closed'))
        }
    }

    private async attach (sessionId: string, type: string): Promise<void> {
        try {
            if (type !== 'page' && type !== 'iframe') return
            // Start detailed coverage before allowing the webview to run.
            await this.send('Profiler.enable', {}, sessionId)
            await this.send('Profiler.startPreciseCoverage', {
                callCount: true, detailed: true, allowTriggeredUpdates: true
            }, sessionId)
            // Auto-attach is not recursive: each page/frame must watch its children.
            await this.send('Target.setAutoAttach', {
                autoAttach: true, waitForDebuggerOnStart: true, flatten: true
            }, sessionId)
        } finally {
            if ((type !== 'page' && type !== 'iframe') || this.sessions.has(sessionId)) {
                await this.send('Runtime.runIfWaitingForDebugger', {}, sessionId)
            }
            if (type !== 'page' && type !== 'iframe') this.sessions.delete(sessionId)
        }
    }

    // Sends a DevTools command and waits for the response with the same id.
    private async send (method: string, params: object = {}, sessionId?: string): Promise<ProtocolResult> {
        const id = ++this.nextId
        return await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id)
                reject(new Error(`Chromium coverage command timed out: ${method}`))
            }, 10000)
            this.pending.set(id, { sessionId, resolve, reject, timeout })
            this.socket?.send(JSON.stringify({ id, method, params, sessionId }))
        })
    }

    // Save extension bundle coverage
    private save (scripts: Profiler.ScriptCoverage[]): void {
        const result: Profiler.ScriptCoverage[] = []
        for (const script of scripts) {
            // Ensure that this script is from our source code
            const output = /\/out\/([^/?#]+\.js)(?:[?#]|$)/.exec(script.url)
            if (output === null) continue
            const outputPath = path.resolve('out', output[1])
            if (!fs.existsSync(outputPath)) continue

            result.push({ ...script, url: pathToFileURL(outputPath).href })
        }
        if (result.length === 0) return
        const directory = process.env.NODE_V8_COVERAGE as string
        fs.mkdirSync(directory, { recursive: true })
        fs.writeFileSync(path.join(directory, `chromium-${process.pid}-${++this.nextId}.json`), JSON.stringify({ result }))
    }

    // On-demand coverage snapshots from each webview.
    async capture (): Promise<void> {
        if (this.socket === undefined) return
        await Promise.all(this.sessions.values())
        if (this.failure !== undefined) throw this.failure
        await Promise.all([...this.sessions.keys()].map(async sessionId => {
            try {
                const { result } = await this.send('Profiler.takePreciseCoverage', {}, sessionId)
                this.save(result ?? [])
            } catch (error) {
                // A webview can disappear while its final snapshot is in flight.
                if (this.sessions.has(sessionId)) throw error
            }
        }))
    }

    async stop (): Promise<void> {
        try {
            await this.capture()
        } finally {
            // Closing the connection detaches from targets and resumes paused frames.
            this.socket?.close()
            this.socket = undefined
        }
    }
}

export const chromiumCoverage = new ChromiumCoverage()
