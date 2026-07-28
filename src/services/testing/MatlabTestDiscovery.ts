// Copyright 2026 The MathWorks, Inc.

import * as path from 'path'
import * as vscode from 'vscode'

import BaseService from '../BaseService'
import { MatlabMVMConnectionState, MVM } from '../../commandwindow/MVM'
import TelemetryLogger from '../telemetry/TelemetryLogger'
import { MatlabTestInfo, TestDiscoveryRawResult } from './MatlabTestInterfaces'

const DISCOVERY_DEBOUNCE_MS = 500
const WORKSPACE_STATE_KEY = 'matlab.testing.folders'
const WORKSPACE_STATE_FILES_KEY = 'matlab.testing.files'
const WORKSPACE_STATE_EXCLUDED_KEY = 'matlab.testing.excludedFiles'

const STATUS_ITEM_ID = 'matlab-status-placeholder'

export default class MatlabTestDiscovery extends BaseService {
    private readonly testFolders: Set<string> = new Set()
    private readonly testFiles: Set<string> = new Set()
    private readonly excludedFiles: Set<string> = new Set()
    private debounceTimer: NodeJS.Timeout | undefined
    private isDiscovering = false
    private rediscoveryRequested = false
    private fileWatchers: vscode.Disposable[] = []

    constructor (
        private readonly controller: vscode.TestController,
        private readonly mvm: MVM,
        private readonly context: vscode.ExtensionContext,
        private readonly telemetryLogger: TelemetryLogger
    ) {
        super()

        this.restorePersistedState()
        this.setupResolveHandler()
        this.registerEventListeners()
    }

    private restorePersistedState (): void {
        this.loadWorkspaceState(WORKSPACE_STATE_KEY, this.testFolders)
        this.loadWorkspaceState(WORKSPACE_STATE_FILES_KEY, this.testFiles)
        this.loadWorkspaceState(WORKSPACE_STATE_EXCLUDED_KEY, this.excludedFiles)

        if (this.mvm.getMatlabState() !== MatlabMVMConnectionState.CONNECTED && this.hasTestSources()) {
            this.showStatusPlaceholder('Connect to MATLAB to discover tests')
        }
    }

    private loadWorkspaceState (key: string, target: Set<string>): void {
        const values = this.context.workspaceState.get<string[]>(key, [])
        values.forEach(v => target.add(v))
    }

    private setupResolveHandler (): void {
        this.controller.resolveHandler = async () => {
            if (this.mvm.getMatlabState() === MatlabMVMConnectionState.CONNECTED) {
                await this.discoverAll()
            }
        }
    }

    private registerEventListeners (): void {
        this.own(this.mvm.on(MVM.Events.stateChanged, (oldState: MatlabMVMConnectionState, newState: MatlabMVMConnectionState) => {
            if (newState === MatlabMVMConnectionState.CONNECTED) {
                this.removeStatusPlaceholder()
                void this.discoverAll()
            } else if (newState === MatlabMVMConnectionState.DISCONNECTED) {
                this.controller.items.replace([])
                if (this.hasTestSources()) {
                    this.showStatusPlaceholder('Connect to MATLAB to discover tests')
                }
            }
        }))

        this.refreshFileWatchers()
    }

    private refreshFileWatchers (): void {
        this.disposeFileWatchers()

        for (const folder of this.testFolders) {
            this.addFileWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), '**/*.m'))
        }

        for (const file of this.testFiles) {
            const dir = vscode.Uri.file(path.dirname(file))
            this.addFileWatcher(new vscode.RelativePattern(dir, path.basename(file)))
        }
    }

    private addFileWatcher (pattern: vscode.RelativePattern): void {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern)
        this.fileWatchers.push(
            watcher,
            watcher.onDidCreate(() => this.debouncedRediscover()),
            watcher.onDidDelete(() => this.debouncedRediscover()),
            watcher.onDidChange(() => this.debouncedRediscover())
        )
    }

    private disposeFileWatchers (): void {
        this.fileWatchers.forEach(d => d.dispose())
        this.fileWatchers = []
    }

    override dispose (): void {
        this.disposeFileWatchers()
        super.dispose()
    }

    /** Discovers tests from all registered folders and files, rebuilding the test tree. */
    async discoverAll (): Promise<void> {
        if (this.mvm.getMatlabState() !== MatlabMVMConnectionState.CONNECTED) {
            return
        }
        if (this.isDiscovering) {
            this.rediscoveryRequested = true
            return
        }

        this.isDiscovering = true
        try {
            this.controller.items.replace([])
            if (this.hasTestSources()) {
                this.showStatusPlaceholder('Discovering tests...')
            }

            if (this.testFolders.size > 0) {
                await this.discoverFromPaths([...this.testFolders], 'folder')
            }

            if (this.testFiles.size > 0) {
                await this.discoverFromPaths([...this.testFiles], 'file')
            }

            this.removeStatusPlaceholder()
        } finally {
            this.isDiscovering = false
            if (this.rediscoveryRequested) {
                this.rediscoveryRequested = false
                void this.discoverAll()
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

        this.controller.items.delete(target.id)

        await this.context.workspaceState.update(WORKSPACE_STATE_EXCLUDED_KEY, [...this.excludedFiles])
        await this.context.workspaceState.update(WORKSPACE_STATE_FILES_KEY, [...this.testFiles])
        this.refreshFileWatchers()
    }

    private async discoverFromPaths (paths: string[], mode: 'file' | 'folder'): Promise<void> {
        try {
            const mdaPaths = { mwtype: 'string', mwsize: [1, paths.length], mwdata: paths }

            const response = await this.mvm.feval<TestDiscoveryRawResult>(
                'matlabls.handlers.testing.discoverTests', 1, [mdaPaths, mode]
            )

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
        if (this.controller.items.get(STATUS_ITEM_ID) != null) return
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
        this.debounceTimer = setTimeout(() => { void this.discoverAll() }, DISCOVERY_DEBOUNCE_MS)
    }
}
