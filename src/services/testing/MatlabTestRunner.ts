// Copyright 2026 The MathWorks, Inc.

import * as vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node'

import BaseService from '../BaseService'
import { MatlabMVMConnectionState, MVM } from '../../commandwindow/MVM'
import TelemetryLogger from '../telemetry/TelemetryLogger'
import Notification from '../../notifications/Notifications'
import { TestRunEventNotification, TestRunCompleteNotification } from './MatlabTestInterfaces'

export default class MatlabTestRunner extends BaseService {
    private readonly runProfile: vscode.TestRunProfile
    private readonly activeRuns = new Map<string, vscode.TestRun>()
    private readonly testItemsByName = new Map<string, vscode.TestItem>()

    constructor (
        private readonly controller: vscode.TestController,
        private readonly client: LanguageClient,
        private readonly mvm: MVM,
        private readonly telemetryLogger: TelemetryLogger
    ) {
        super()

        this.runProfile = this.controller.createRunProfile(
            'Run Tests',
            vscode.TestRunProfileKind.Run,
            (request, token) => this.runTests(request, token)
        )
        this.own(this.runProfile)

        this.own(
            this.client.onNotification(Notification.TestRunEvent, (data: TestRunEventNotification) => {
                this.handleTestRunEvent(data)
            }),
            this.client.onNotification(Notification.TestRunComplete, (data: TestRunCompleteNotification) => {
                this.handleTestRunComplete(data)
            }),
            this.client.onNotification(Notification.TestRunOutput, (data: { runId: string, text: string }) => {
                const run = this.activeRuns.get(data.runId)
                if (run != null) {
                    run.appendOutput(data.text.replace(/\r?\n/g, '\r\n'))
                }
            }),
            this.mvm.on(MVM.Events.stateChanged, (oldState: MatlabMVMConnectionState, newState: MatlabMVMConnectionState) => {
                if (newState === MatlabMVMConnectionState.DISCONNECTED) {
                    this.endAllActiveRuns('MATLAB disconnected')
                }
            })
        )
    }

    public runAll (): void {
        const request = new vscode.TestRunRequest()
        void this.runTests(request, new vscode.CancellationTokenSource().token)
    }

    private async runTests (request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
        if (this.mvm.getMatlabState() !== MatlabMVMConnectionState.CONNECTED) {
            void vscode.window.showWarningMessage('Connect to MATLAB to run tests.')
            return
        }

        const run = this.controller.createTestRun(request)
        const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

        this.activeRuns.set(runId, run)

        const testItems = this.collectTestItems(request)
        const testFiles = new Set<string>()
        const testNames: string[] = []
        const isSelectiveRun = request.include != null && request.include.length > 0

        for (const item of testItems) {
            run.enqueued(item)

            const filePath = item.uri?.fsPath ?? ''
            this.testItemsByName.set(`${filePath}::${item.id}`, item)

            if (item.uri != null) {
                testFiles.add(item.uri.fsPath)
            }

            if (isSelectiveRun) {
                testNames.push(item.id)
            }
        }

        token.onCancellationRequested(() => {
            this.mvm.interrupt()
            this.telemetryLogger.logEvent({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'testing.cancel' }
            })
        })

        this.telemetryLogger.logEvent({
            eventKey: 'ML_VS_CODE_ACTIONS',
            data: { action_type: 'testing.run', test_count: testItems.length }
        })

        void this.client.sendNotification(Notification.TestRunRequest, {
            runId,
            testFiles: [...testFiles],
            testNames: isSelectiveRun ? testNames : undefined
        })
    }

    private handleTestRunEvent (data: TestRunEventNotification): void {
        const run = this.activeRuns.get(data.runId)
        if (run == null) return

        const event = data.event
        const testName = event.testName as string
        const rawTestFile = (event.testFile as string) ?? ''
        const testFile = rawTestFile !== '' ? vscode.Uri.file(rawTestFile).fsPath : ''
        const testItem = this.testItemsByName.get(`${testFile}::${testName}`)
        if (testItem == null) return

        if (event.type === 'started') {
            run.started(testItem)
        } else if (event.type === 'finished') {
            this.applyTestResult(run, testItem, event)
        }
    }

    private applyTestResult (run: vscode.TestRun, testItem: vscode.TestItem, event: Record<string, unknown>): void {
        const durationMs = event.duration != null ? (event.duration as number) * 1000 : undefined

        switch (event.status) {
            case 'passed':
                run.passed(testItem, durationMs)
                break
            case 'failed': {
                const messages = this.buildTestMessages(event.diagnostics)
                run.failed(testItem, messages, durationMs)
                break
            }
            case 'incomplete': {
                run.skipped(testItem)
                break
            }
            default:
                run.skipped(testItem)
        }
    }

    private buildTestMessages (diagnostics: unknown): vscode.TestMessage[] {
        const diagArray = this.unwrapDiagnostics(diagnostics)
        if (diagArray.length === 0) {
            return [new vscode.TestMessage('Test failed')]
        }

        return diagArray.map((diag: Record<string, unknown>) => {
            const msgText = (diag.message as string) ?? 'Test failed'
            const message = new vscode.TestMessage(msgText)
            const failedInFile = diag.failedInFile as string
            const failedOnLine = diag.failedOnLine as number
            if (failedInFile != null && failedInFile !== '' && failedOnLine > 0) {
                message.location = new vscode.Location(
                    vscode.Uri.file(failedInFile),
                    new vscode.Position(failedOnLine - 1, 0)
                )
            }
            return message
        })
    }

    private unwrapDiagnostics (diagnostics: unknown): Array<Record<string, unknown>> {
        if (Array.isArray(diagnostics)) {
            return diagnostics as Array<Record<string, unknown>>
        }
        if (diagnostics != null && typeof diagnostics === 'object' && 'mwdata' in diagnostics) {
            const mwdata = (diagnostics as { mwdata: unknown }).mwdata
            if (Array.isArray(mwdata)) {
                return mwdata as Array<Record<string, unknown>>
            }
        }
        return []
    }

    private handleTestRunComplete (data: TestRunCompleteNotification): void {
        const run = this.activeRuns.get(data.runId)
        if (run == null) return

        if (data.error != null) {
            void vscode.window.showErrorMessage(`MATLAB test run failed: ${data.error}`)
        }

        run.end()
        this.activeRuns.delete(data.runId)
    }

    private endAllActiveRuns (error: string): void {
        for (const [runId, run] of this.activeRuns) {
            void vscode.window.showErrorMessage(`MATLAB test run failed: ${error}`)
            run.end()
            this.activeRuns.delete(runId)
        }
    }

    private collectTestItems (request: vscode.TestRunRequest): vscode.TestItem[] {
        const items: vscode.TestItem[] = []

        if (request.include != null && request.include.length > 0) {
            for (const item of request.include) {
                this.collectLeafItems(item, items)
            }
        } else {
            this.controller.items.forEach(item => {
                this.collectLeafItems(item, items)
            })
        }

        return items
    }

    private collectLeafItems (item: vscode.TestItem, result: vscode.TestItem[]): void {
        if (item.children.size === 0) {
            result.push(item)
        } else {
            item.children.forEach(child => {
                this.collectLeafItems(child, result)
            })
        }
    }
}
