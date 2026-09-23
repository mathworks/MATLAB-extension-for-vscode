// Copyright 2026 The MathWorks, Inc.

import * as path from 'path'
import * as vscode from 'vscode'

import BaseService from '../BaseService'
import { MatlabMVMConnectionState, MVM } from '../../commandwindow/MVM'
import TelemetryLogger from '../telemetry/TelemetryLogger'
import { MatlabTestInfo, TestDiscoveryRawResult } from './MatlabTestInterfaces'

const DISCOVERY_DEBOUNCE_MS = 2000
const WORKSPACE_STATE_KEY = 'matlab.testing.folders'
const WORKSPACE_STATE_FILES_KEY = 'matlab.testing.files'
const WORKSPACE_STATE_EXCLUDED_KEY = 'matlab.testing.excludedFiles'

const AUTO_DISCOVER_SETTING = 'MATLAB.discoverTestsAutomatically'

const STATUS_ITEM_ID = 'matlab-status-placeholder'
const PLACEHOLDER_CONNECT = 'Connect to MATLAB to discover tests'
const PLACEHOLDER_REFRESH = 'Select the refresh button to discover tests'
const PLACEHOLDER_DISCOVERING = 'Discovering tests...'
const PLACEHOLDER_WAITING = 'Tests will be discovered when MATLAB is available...'

export default class MatlabTestDiscovery extends BaseService {
    private readonly testFolders: Set<string> = new Set()
    private readonly testFiles: Set<string> = new Set()
    private readonly excludedFiles: Set<string> = new Set()
    private readonly discoveredTestFiles: Set<string> = new Set()
    private debounceTimer: NodeJS.Timeout | undefined
    private cancelSource: vscode.CancellationTokenSource | undefined
    private discoveryPending = false
    private autoDiscoverEnabled: boolean
    private fileWatchers: vscode.Disposable[] = []

    constructor (
        private readonly controller: vscode.TestController,
        private readonly mvm: MVM,
        private readonly context: vscode.ExtensionContext,
        private readonly telemetryLogger: TelemetryLogger
    ) {
        super()

        this.autoDiscoverEnabled = MatlabTestDiscovery.isAutoDiscoverEnabled()
        this.restorePersistedState()
        this.setupHandlers()
        this.registerEventListeners()
    }

    private static isAutoDiscoverEnabled (): boolean {
        return vscode.workspace.getConfiguration('MATLAB').get<boolean>('discoverTestsAutomatically') ?? true
    }

    private restorePersistedState (): void {
        this.loadWorkspaceState(WORKSPACE_STATE_KEY, this.testFolders)
        this.loadWorkspaceState(WORKSPACE_STATE_FILES_KEY, this.testFiles)
        this.loadWorkspaceState(WORKSPACE_STATE_EXCLUDED_KEY, this.excludedFiles)

        if (this.mvm.getMatlabState() !== MatlabMVMConnectionState.CONNECTED && this.hasTestSources()) {
            this.showStatusPlaceholder(PLACEHOLDER_CONNECT)
        }
    }

    private loadWorkspaceState (key: string, target: Set<string>): void {
        const values = this.context.workspaceState.get<string[]>(key, [])
        values.forEach(v => target.add(v))
    }

    private setupHandlers (): void {
        this.controller.resolveHandler = async () => {
            this.discoverAllAutomatic()
        }
        this.controller.refreshHandler = async (token: vscode.CancellationToken) => {
            await this.discoverAll(token)
        }
    }

    private registerEventListeners (): void {
        this.own(this.mvm.on(MVM.Events.stateChanged, (oldState: MatlabMVMConnectionState, newState: MatlabMVMConnectionState) => {
            if (newState === MatlabMVMConnectionState.CONNECTED) {
                this.removeStatusPlaceholder()
                if (this.autoDiscoverEnabled) {
                    this.discoverAllAutomatic()
                } else if (this.hasTestSources()) {
                    this.showStatusPlaceholder(PLACEHOLDER_REFRESH)
                }
            } else if (newState === MatlabMVMConnectionState.DISCONNECTED) {
                this.discoveryPending = false
                this.controller.items.replace([])
                this.discoveredTestFiles.clear()
                if (this.hasTestSources()) {
                    this.showStatusPlaceholder(PLACEHOLDER_CONNECT)
                }
            }
        }))

        // Re-run a deferred discovery once MATLAB is no longer busy with user work or debugging.
        this.own(this.mvm.on(MVM.Events.promptChange, (_state: string, isIdle: boolean) => {
            if (isIdle) {
                this.runPendingDiscovery()
            }
        }))
        this.own(this.mvm.on(MVM.Events.debuggingStateChanged, (isDebugging: boolean) => {
            if (!isDebugging) {
                this.runPendingDiscovery()
            }
        }))

        this.own(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(AUTO_DISCOVER_SETTING)) {
                this.handleAutoDiscoverSettingChanged()
            }
        }))

        this.refreshFileWatchers()
    }

    private handleAutoDiscoverSettingChanged (): void {
        const enabled = MatlabTestDiscovery.isAutoDiscoverEnabled()
        if (enabled === this.autoDiscoverEnabled) {
            return
        }
        this.autoDiscoverEnabled = enabled

        if (enabled) {
            this.refreshFileWatchers()
        } else {
            this.discoveryPending = false
            this.disposeFileWatchers()
        }
    }

    private refreshFileWatchers (): void {
        this.disposeFileWatchers()

        if (!this.autoDiscoverEnabled) {
            return
        }

        for (const folder of this.testFolders) {
            this.addFolderWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), '**/*.m'))
        }

        for (const file of this.testFiles) {
            const dir = vscode.Uri.file(path.dirname(file))
            this.addFileSourceWatcher(new vscode.RelativePattern(dir, path.basename(file)))
        }
    }

    private addFolderWatcher (pattern: vscode.RelativePattern): void {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern)
        this.fileWatchers.push(
            watcher,
            watcher.onDidChange(uri => this.onKnownTestFileChanged(uri)),
            watcher.onDidDelete(uri => this.onKnownTestFileChanged(uri))
        )
    }

    private addFileSourceWatcher (pattern: vscode.RelativePattern): void {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern)
        this.fileWatchers.push(
            watcher,
            watcher.onDidCreate(() => this.debouncedRediscover()),
            watcher.onDidDelete(() => this.debouncedRediscover()),
            watcher.onDidChange(() => this.debouncedRediscover())
        )
    }

    private onKnownTestFileChanged (uri: vscode.Uri): void {
        if (this.discoveredTestFiles.has(uri.fsPath)) {
            this.debouncedRediscover()
        }
    }

    private disposeFileWatchers (): void {
        this.fileWatchers.forEach(d => d.dispose())
        this.fileWatchers = []
    }

    override dispose (): void {
        if (this.debounceTimer != null) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = undefined
        }
        this.cancelSource?.cancel()
        this.cancelSource?.dispose()
        this.cancelSource = undefined
        this.disposeFileWatchers()
        super.dispose()
    }

    /** Discovers tests from all registered folders and files, rebuilding the test tree. */
    async discoverAll (token?: vscode.CancellationToken): Promise<void> {
        await this.runDiscovery(token)
    }

    /** Runs discovery from an automatic trigger, honoring the setting and the busy/debug guard. */
    private discoverAllAutomatic (): void {
        if (!this.autoDiscoverEnabled) {
            return
        }
        if (this.mvm.getMatlabState() !== MatlabMVMConnectionState.CONNECTED) {
            return
        }
        if (this.mvm.isDebugging() || this.mvm.isBusy()) {
            this.discoveryPending = true
            if (this.controller.items.size === 0 && this.hasTestSources()) {
                this.showStatusPlaceholder(PLACEHOLDER_WAITING)
            }
            return
        }
        void this.runDiscovery()
    }

    private runPendingDiscovery (): void {
        if (!this.discoveryPending) {
            return
        }
        if (this.mvm.getMatlabState() !== MatlabMVMConnectionState.CONNECTED) {
            return
        }
        if (this.mvm.isDebugging() || this.mvm.isBusy()) {
            return
        }
        this.discoveryPending = false
        void this.runDiscovery()
    }

    private async runDiscovery (externalToken?: vscode.CancellationToken): Promise<void> {
        if (this.mvm.getMatlabState() !== MatlabMVMConnectionState.CONNECTED) {
            return
        }

        this.cancelSource?.cancel()
        this.cancelSource?.dispose()
        const cancelSource = new vscode.CancellationTokenSource()
        this.cancelSource = cancelSource
        const token = cancelSource.token

        const externalSub = externalToken?.onCancellationRequested(() => cancelSource.cancel())
        const interruptSub = token.onCancellationRequested(() => this.mvm.interrupt())

        try {
            this.controller.items.replace([])
            this.discoveredTestFiles.clear()
            if (this.hasTestSources()) {
                this.showStatusPlaceholder(PLACEHOLDER_DISCOVERING)
            }

            if (this.testFolders.size > 0 && !token.isCancellationRequested) {
                await this.discoverFromPaths([...this.testFolders], 'folder', token)
            }

            if (this.testFiles.size > 0 && !token.isCancellationRequested) {
                await this.discoverFromPaths([...this.testFiles], 'file', token)
            }

            this.removeStatusPlaceholder()
        } finally {
            externalSub?.dispose()
            interruptSub.dispose()
            cancelSource.dispose()
            if (this.cancelSource === cancelSource) {
                this.cancelSource = undefined
            }
        }
    }

    /** Prompts the user to select folder(s) and discovers tests within them. */
    async addTestFolder (): Promise<void> {
        const selected = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: true,
            title: 'Select test folder(s)'
        })
        if (selected == null || selected.length === 0) return

        for (const uri of selected) {
            this.testFolders.add(uri.fsPath)
            for (const excluded of this.excludedFiles) {
                if (excluded.startsWith(uri.fsPath)) {
                    this.excludedFiles.delete(excluded)
                }
            }
        }
        await this.context.workspaceState.update(WORKSPACE_STATE_KEY, [...this.testFolders])
        await this.context.workspaceState.update(WORKSPACE_STATE_EXCLUDED_KEY, [...this.excludedFiles])
        this.refreshFileWatchers()

        if (this.mvm.getMatlabState() === MatlabMVMConnectionState.CONNECTED) {
            const paths = selected.map(u => u.fsPath)
            await this.discoverFromPaths(paths, 'folder')
        }
    }

    /** Prompts the user to select .m file(s) and discovers tests within them. */
    async addTestFile (): Promise<void> {
        const selected = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            filters: { 'MATLAB Files': ['m'] },
            title: 'Select test file(s)'
        })
        if (selected == null || selected.length === 0) return

        for (const uri of selected) {
            this.testFiles.add(uri.fsPath)
            this.excludedFiles.delete(uri.fsPath)
        }
        await this.context.workspaceState.update(WORKSPACE_STATE_FILES_KEY, [...this.testFiles])
        await this.context.workspaceState.update(WORKSPACE_STATE_EXCLUDED_KEY, [...this.excludedFiles])
        this.refreshFileWatchers()

        if (this.mvm.getMatlabState() === MatlabMVMConnectionState.CONNECTED) {
            const paths = selected.map(u => u.fsPath)
            await this.discoverFromPaths(paths, 'file')
        }
    }

    /** Removes a test item from the tree and excludes its file from future discovery. */
    async removeTestItem (target: vscode.TestItem): Promise<void> {
        if (target == null) return

        while (target.parent != null) {
            target = target.parent
        }

        const filePath = target.uri?.fsPath ?? target.id
        this.excludedFiles.add(filePath)
        this.testFiles.delete(filePath)
        this.discoveredTestFiles.delete(filePath)

        this.controller.items.delete(target.id)

        await this.context.workspaceState.update(WORKSPACE_STATE_EXCLUDED_KEY, [...this.excludedFiles])
        await this.context.workspaceState.update(WORKSPACE_STATE_FILES_KEY, [...this.testFiles])
        this.refreshFileWatchers()
    }

    /** Removes all registered test folders and files after user confirmation. */
    async clearAllTestSources (): Promise<void> {
        if (!this.hasTestSources()) return

        const confirmAction = 'Clear All Tests'
        const confirm = await vscode.window.showWarningMessage(
            'Remove all test folders and files from the Test Explorer?',
            { modal: true },
            confirmAction
        )
        if (confirm !== confirmAction) return

        this.cancelSource?.cancel()
        this.discoveryPending = false
        this.testFolders.clear()
        this.testFiles.clear()
        this.excludedFiles.clear()
        this.discoveredTestFiles.clear()

        await this.context.workspaceState.update(WORKSPACE_STATE_KEY, [])
        await this.context.workspaceState.update(WORKSPACE_STATE_FILES_KEY, [])
        await this.context.workspaceState.update(WORKSPACE_STATE_EXCLUDED_KEY, [])

        this.disposeFileWatchers()
        this.controller.items.replace([])
    }

    private async discoverFromPaths (paths: string[], mode: 'file' | 'folder', token?: vscode.CancellationToken): Promise<void> {
        try {
            const mdaPaths = { mwtype: 'string', mwsize: [1, paths.length], mwdata: paths }

            const response = await this.mvm.feval<TestDiscoveryRawResult>(
                'matlabls.handlers.testing.discoverTests', 1, [mdaPaths, mode]
            )

            if (token?.isCancellationRequested === true) {
                return
            }

            if ('error' in response) {
                const error = (response as { error: Record<string, unknown> }).error
                const errMsg = typeof error?.msg === 'string' ? error.msg : ''
                if (errMsg !== '') {
                    void vscode.window.showWarningMessage(`Test discovery error: ${errMsg}`)
                }
                return
            }

            const discoveryResult = (response as { result: TestDiscoveryRawResult[] }).result?.[0]

            if (discoveryResult == null) {
                void vscode.window.showWarningMessage('Test discovery: unexpected empty response from MATLAB')
                return
            }

            if (discoveryResult.error != null && discoveryResult.error !== '') {
                void vscode.window.showWarningMessage(`Test discovery: ${discoveryResult.error}`)
                return
            }

            if (discoveryResult.warning != null && discoveryResult.warning !== '') {
                void vscode.window.showWarningMessage(`Test discovery: ${discoveryResult.warning}`)
            }

            const tests = this.parseRawResult(discoveryResult)
            if (tests.length === 0) {
                void vscode.window.showInformationMessage('No MATLAB tests found in the selected location.')
                return
            }

            this.buildTestTree(tests)
            this.telemetryLogger.logEvent({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: { action_type: 'testing.discover', test_count: tests.length }
            })
        } catch {
            // MATLAB disconnected or feval rejected — leave tree as-is
        }
    }

    private parseRawResult (raw: TestDiscoveryRawResult): MatlabTestInfo[] {
        const tests: MatlabTestInfo[] = []
        const names = this.unwrapCellArray(raw.names)
        const filenames = this.unwrapCellArray(raw.filenames)
        const procedureNames = this.unwrapCellArray(raw.procedureNames)
        const testParentNames = this.unwrapCellArray(raw.testParentNames)
        const parameterizations = this.unwrapCellArray(raw.parameterizations)

        for (let i = 0; i < names.length; i++) {
            tests.push({
                name: names[i],
                filename: filenames[i],
                procedureName: procedureNames[i],
                testParentName: testParentNames[i],
                parameterization: parameterizations[i]
            })
        }
        return tests
    }

    private unwrapCellArray (value: unknown): string[] {
        if (Array.isArray(value)) {
            return value as string[]
        }
        if (value != null && typeof value === 'object' && 'mwdata' in value) {
            return (value as { mwdata: string[] }).mwdata
        }
        return []
    }

    private buildTestTree (tests: MatlabTestInfo[]): void {
        const filtered = tests.filter(t => !this.excludedFiles.has(t.filename))
        const groupedByFile = this.groupBy(filtered, t => t.filename)

        for (const [filename, fileTests] of groupedByFile) {
            this.discoveredTestFiles.add(filename)
            const fileItem = this.getOrCreateFileItem(filename)
            this.populateFileItem(fileItem, fileTests)
        }
    }

    private getOrCreateFileItem (filename: string): vscode.TestItem {
        let fileItem = this.controller.items.get(filename)
        if (fileItem == null) {
            const fileUri = vscode.Uri.file(filename)
            fileItem = this.controller.createTestItem(filename, path.basename(filename), fileUri)
            fileItem.range = new vscode.Range(0, 0, 0, 0)
            this.controller.items.add(fileItem)
        }
        fileItem.children.replace([])
        return fileItem
    }

    private populateFileItem (fileItem: vscode.TestItem, fileTests: MatlabTestInfo[]): void {
        const fileUri = fileItem.uri!
        const groupedByMethod = this.groupBy(fileTests, t => t.procedureName)

        for (const [methodName, methodTests] of groupedByMethod) {
            if (methodTests.length === 1 && methodTests[0].parameterization === '') {
                const methodItem = this.controller.createTestItem(methodTests[0].name, methodName, fileUri)
                methodItem.range = new vscode.Range(0, 0, 0, 0)
                fileItem.children.add(methodItem)
            } else {
                this.createParameterizedMethodItem(fileItem, fileUri, methodName, methodTests)
            }
        }
    }

    private createParameterizedMethodItem (fileItem: vscode.TestItem, fileUri: vscode.Uri, methodName: string, methodTests: MatlabTestInfo[]): void {
        const methodId = `${methodTests[0].testParentName}/${methodName}`
        const methodItem = this.controller.createTestItem(methodId, methodName, fileUri)
        methodItem.range = new vscode.Range(0, 0, 0, 0)
        fileItem.children.add(methodItem)

        for (const test of methodTests) {
            const paramLabel = test.parameterization !== '' ? test.parameterization : test.name
            const paramItem = this.controller.createTestItem(test.name, paramLabel, fileUri)
            paramItem.range = new vscode.Range(0, 0, 0, 0)
            methodItem.children.add(paramItem)
        }
    }

    private groupBy<T> (items: T[], keyFn: (item: T) => string): Map<string, T[]> {
        const map = new Map<string, T[]>()
        for (const item of items) {
            const key = keyFn(item)
            const existing = map.get(key) ?? []
            existing.push(item)
            map.set(key, existing)
        }
        return map
    }

    private hasTestSources (): boolean {
        return this.testFolders.size > 0 || this.testFiles.size > 0
    }

    private showStatusPlaceholder (label: string): void {
        const existing = this.controller.items.get(STATUS_ITEM_ID)
        if (existing != null) {
            existing.label = label
            return
        }
        const item = this.controller.createTestItem(STATUS_ITEM_ID, label)
        item.canResolveChildren = false
        this.controller.items.add(item)
    }

    private removeStatusPlaceholder (): void {
        this.controller.items.delete(STATUS_ITEM_ID)
    }

    private debouncedRediscover (): void {
        if (this.debounceTimer != null) {
            clearTimeout(this.debounceTimer)
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined
            this.discoverAllAutomatic()
        }, DISCOVERY_DEBOUNCE_MS)
    }
}
