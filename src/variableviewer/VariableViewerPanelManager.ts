// Copyright 2026 The MathWorks, Inc.

import * as vscode from 'vscode'
import BaseService from '../services/BaseService'
import { MVM, MatlabMVMConnectionState } from '../commandwindow/MVM'
import VariableViewerService from './VariableViewerService'
import {
    VariableMetadata,
    ExtToVVWebview,
    VVWebviewToExt,
    VVServerResponse,
    WorkspaceVariableSummary
} from './types'
import { RendererType, selectRenderer } from './validation'
import { getVariableViewerHtml } from './templates'
import TelemetryLogger from '../services/telemetry/TelemetryLogger'
import { getElementId, hashVariableName, formatDimensions } from './telemetryHelpers'

const VIEW_TYPE = 'matlabVariableViewer'

// Minimum MATLAB release that supports the Variable Viewer fallback path
const VV_MINIMUM_RELEASE = 'R2023a'

// Dead-man switch: if no server response arrives within this window, post an error
const REQUEST_TIMEOUT_MS: number = 15000

/** Cached metadata and renderer classification for an open variable panel, used for banner updates and webview recreation. */
interface CachedVariableState {
    metadata: VariableMetadata
    rendererType: RendererType
    preview?: string
    loggedScrollH: boolean
    loggedScrollV: boolean
}

/**
 * Manages the lifecycle of Variable Viewer WebviewPanels.
 * Each open variable gets its own editor-area tab, tracked in a map keyed by variable name.
 * Routes server responses to the correct panel and handles webview-initiated requests.
 */
export default class VariableViewerPanelManager extends BaseService {
    private readonly panels: Map<string, vscode.WebviewPanel> = new Map()

    // Cached state per variable, used for banner updates, type transitions, and webview recreation
    private readonly variableState: Map<string, CachedVariableState> = new Map()

    // Reverse lookup: panel → current variable name. Closures captured at panel creation
    // read from this map so that renames propagate without recreating the panel.
    private readonly panelVarNames: Map<vscode.WebviewPanel, string> = new Map()

    // Variable names with an in-flight rename. While a name is in this set,
    // deletion signals (workspace refresh, server errors) are suppressed
    // because transient workspace states during the rename would otherwise
    // destroy the panel before the rename completes.
    private readonly pendingRenames: Set<string> = new Set()

    // Active request timeout timers keyed by variable name. If a server response doesn't
    // arrive within REQUEST_TIMEOUT_MS, the timer fires an error to the panel so that it
    // is clear that the request was lost.
    private readonly requestTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

    // Last reported viewport dimensions per variable, sent by the webview on mount and resize
    private readonly viewportSizes: Map<string, { width: number, height: number }> = new Map()

    /**
     * @param extensionContext - The VS Code extension context for resource URI resolution.
     * @param service - The communication bridge to the MATLAB language server.
     * @param mvm - The MATLAB Virtual Machine handle for connection and idle state.
     * @param telemetryLogger - The telemetry logger for DDUX events.
     * @param onWorkspaceRefreshed - Event fired when the Workspace Browser receives fresh variable data.
     * @param onVariableRenamed - Event fired when a variable is renamed in the Workspace Browser.
     */
    constructor (
        private readonly extensionContext: vscode.ExtensionContext,
        private readonly service: VariableViewerService,
        private readonly mvm: MVM,
        private readonly telemetryLogger: TelemetryLogger,
        onWorkspaceRefreshed: vscode.Event<WorkspaceVariableSummary[]>,
        onVariableRenamed: vscode.Event<{ oldName: string, newName: string }>
    ) {
        super()

        this.service.setResponseListener((response: VVServerResponse) => {
            this.handleServerResponse(response)
        })

        this.own(
            mvm.on(MVM.Events.stateChanged, (_oldState: MatlabMVMConnectionState, newState: MatlabMVMConnectionState) => {
                this.onMatlabStateChanged(newState)
            }),
            mvm.on(MVM.Events.promptChange, (_state: string, isIdle: boolean) => {
                this.broadcastMatlabState(isIdle)
                if (isIdle) {
                    this.invalidateVisiblePanels()
                }
            }),
            onWorkspaceRefreshed((vars) => {
                this.onWorkspaceRefreshed(vars)
            }),
            onVariableRenamed(({ oldName, newName }) => {
                this.handleVariableRenamed(oldName, newName)
            }),
            vscode.commands.registerCommand('matlab.openVariableViewer', (context: string | { varName: string }) => {
                const varName = typeof context === 'string' ? context : context.varName
                this.openVariable(varName)
            })
        )
    }

    // ── Public API ───────────────────────────────────────────────────

    /**
     * Opens or reveals a Variable Viewer tab for the given variable.
     * If a panel already exists, it is focused. Otherwise a new panel is created
     * and variable data is requested from the server.
     * @param varName - The MATLAB workspace variable name to view.
     */
    openVariable (varName: string): void {
        if (this.mvm.getMatlabState() !== MatlabMVMConnectionState.CONNECTED) {
            return
        }

        const release = this.mvm.getMatlabRelease()
        if (release == null || release < VV_MINIMUM_RELEASE) {
            return
        }

        const existing = this.panels.get(varName)
        if (existing != null) {
            existing.reveal()
            return
        }

        this.createPanel(varName)
        this.service.sendRequest({ type: 'QueryVariable', varName })
        this.startRequestTimer(varName, 'QueryVariable')
    }

    /**
     * Called when the Workspace Browser receives fresh variable data.
     * Diffs against cached metadata to determine what each open panel needs:
     * deleted variables get the deletion flow, changed variables get re-queried,
     * and unchanged variables receive a stale-data notification.
     * @param variables - The current list of workspace variable summaries.
     */
    onWorkspaceRefreshed (variables: WorkspaceVariableSummary[]): void {
        if (this.panels.size === 0) return

        const varMap = new Map(variables.map(v => [v.name, v]))

        for (const [varName] of this.panels) {
            const summary = varMap.get(varName)

            if (summary == null) {
                if (this.pendingRenames.has(varName)) continue
                this.handleVariableDeleted({ type: 'VariableDeleted', varName })
                continue
            }

            if (this.pendingRenames.has(varName)) {
                this.pendingRenames.delete(varName)
                this.service.sendRequest({ type: 'QueryVariable', varName })
                this.startRequestTimer(varName, 'QueryVariable')
                continue
            }

            const cached = this.variableState.get(varName)
            if (cached == null || cached.metadata.dataType !== summary.className || cached.metadata.size.join('x') !== summary.size) {
                this.service.sendRequest({ type: 'QueryVariable', varName })
                this.startRequestTimer(varName, 'QueryVariable')
            } else {
                this.postToPanel(varName, { type: 'dataStale' })
            }
        }
    }

    /**
     * Called when the Workspace Browser successfully renames a variable.
     * Re-keys the panel and cached state from oldName to newName, updates the
     * tab title, and notifies the webview so it can update its banner and renderer.
     * @param oldName - The variable's previous name.
     * @param newName - The variable's new name.
     */
    handleVariableRenamed (oldName: string, newName: string): void {
        const panel = this.panels.get(oldName)
        if (panel == null) return

        this.clearRequestTimer(oldName)
        this.panels.delete(oldName)
        this.panels.set(newName, panel)

        const cached = this.variableState.get(oldName)
        if (cached != null) {
            this.variableState.delete(oldName)
            this.variableState.set(newName, cached)
            this.updatePanelTitle(newName)
        } else {
            panel.title = newName
        }

        this.panelVarNames.set(panel, newName)
        this.pendingRenames.add(newName)

        this.postToPanel(newName, { type: 'variableRenamed', oldName, newName })
    }

    // ── Panel Creation & Lifecycle ───────────────────────────────────

    /**
     * Creates a new WebviewPanel for the given variable, registers message and dispose handlers,
     * and adds it to the panels map.
     * @param varName - The variable name to create a panel for.
     * @returns The newly created WebviewPanel.
     */
    private createPanel (varName: string): vscode.WebviewPanel {
        const panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            varName,
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                localResourceRoots: [this.extensionContext.extensionUri]
            }
        )

        panel.webview.html = getVariableViewerHtml(panel.webview, this.extensionContext.extensionUri, varName)

        this.panelVarNames.set(panel, varName)

        panel.webview.onDidReceiveMessage((msg: unknown) => {
            const currentName = this.panelVarNames.get(panel) ?? varName
            this.onWebviewMessage(currentName, msg as VVWebviewToExt)
        })

        panel.onDidDispose(() => {
            const currentName = this.panelVarNames.get(panel) ?? varName

            const cached = this.variableState.get(currentName)
            if (cached != null) {
                const viewport = this.viewportSizes.get(currentName)
                this.telemetryLogger.logEvent({
                    eventKey: 'ML_VS_CODE_ACTIONS',
                    data: {
                        action_type: 'vvVariableClosed',
                        elementId: getElementId(cached.metadata.dataType, cached.rendererType, cached.metadata.size),
                        nameHash: hashVariableName(currentName),
                        viewportWidth: viewport?.width ?? 0,
                        viewportHeight: viewport?.height ?? 0
                    }
                })
            }

            this.clearRequestTimer(currentName)
            this.panels.delete(currentName)
            this.variableState.delete(currentName)
            this.viewportSizes.delete(currentName)
            this.panelVarNames.delete(panel)
        })

        this.panels.set(varName, panel)
        return panel
    }

    // ── Server Response Handling ─────────────────────────────────────

    /**
     * Routes a server response to the appropriate handler based on its type.
     * @param response - The server response to handle.
     */
    private handleServerResponse (response: VVServerResponse): void {
        switch (response.type) {
            case 'VariableResponse':
                this.clearRequestTimer(response.varName)
                this.handleVariableResponse(response)
                break
            case 'VariableChanged':
                this.handleVariableChanged(response)
                break
            case 'VariableDeleted':
                this.clearRequestTimer(response.varName)
                this.handleVariableDeleted(response)
                break
            case 'Error':
                this.clearRequestTimer(response.varName)
                if (this.isVariableNotFoundError(response.message) && !this.pendingRenames.has(response.varName)) {
                    this.handleVariableDeleted({ type: 'VariableDeleted', varName: response.varName })
                } else if (!this.isVariableNotFoundError(response.message)) {
                    this.postToPanel(response.varName, {
                        type: 'error',
                        varName: response.varName,
                        requestType: response.requestType,
                        message: this.translateError(response.varName, response.message)
                    })
                }
                break
        }
    }

    /**
     * Processes a full variable response: caches state, updates the panel title,
     * converts 1-based server indices to 0-based, and posts the data to the webview.
     * @param response - The variable response from the server.
     */
    private handleVariableResponse (response: Extract<VVServerResponse, { type: 'VariableResponse' }>): void {
        const rendererType = selectRenderer(response.metadata)
        const isFirstResponse = !this.variableState.has(response.varName)

        this.variableState.set(response.varName, {
            metadata: response.metadata,
            rendererType,
            preview: response.preview,
            loggedScrollH: false,
            loggedScrollV: false
        })

        if (isFirstResponse) {
            this.telemetryLogger.logEvent({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: {
                    action_type: 'vvVariableOpened',
                    dimensions: formatDimensions(response.metadata.size),
                    elementId: getElementId(response.metadata.dataType, rendererType, response.metadata.size),
                    openVariableCount: this.panels.size,
                    nameHash: hashVariableName(response.varName)
                }
            })
        }

        this.updatePanelTitle(response.varName)

        const cells = response.cells != null
            ? { data: response.cells.data, startRow: response.cells.startRow - 1, startCol: response.cells.startCol - 1 }
            : undefined

        this.postToPanel(response.varName, {
            type: 'variableResponse',
            varName: response.varName,
            metadata: response.metadata,
            columns: response.columns,
            rows: response.rows,
            rendererType,
            cells,
            preview: response.preview
        })
    }

    /**
     * Handles a variable-changed notification by re-querying the full variable data.
     * @param response - The change notification from the server.
     */
    private handleVariableChanged (response: Extract<VVServerResponse, { type: 'VariableChanged' }>): void {
        this.service.sendRequest({ type: 'QueryVariable', varName: response.varName })
        this.startRequestTimer(response.varName, 'QueryVariable')
    }

    /**
     * Handles variable deletion by notifying the webview inline and replacing the panel HTML
     * with the static deleted-variable page.
     * @param response - The deletion notification.
     */
    private handleVariableDeleted (response: Extract<VVServerResponse, { type: 'VariableDeleted' }>): void {
        if (this.pendingRenames.has(response.varName)) return

        const panel = this.panels.get(response.varName)
        if (panel == null) return

        this.postToPanel(response.varName, { type: 'variableDeleted', varName: response.varName })
        this.variableState.delete(response.varName)
    }

    // ── Webview Message Handling ─────────────────────────────────────

    /**
     * Routes messages from the webview to the appropriate action (data request, open in MATLAB).
     * @param varName - The variable this webview belongs to.
     * @param msg - The message from the webview.
     */
    private onWebviewMessage (varName: string, msg: VVWebviewToExt): void {
        switch (msg.type) {
            case 'ready':
                this.handleWebviewReady(varName)
                break
            case 'requestPage':
                this.service.sendRequest({
                    type: 'QueryPage',
                    varName: msg.varName,
                    startRow: msg.startRow + 1,
                    startCol: msg.startCol + 1
                })
                break
            case 'scrolled':
                this.handleScrollTelemetry(varName, msg.scrollType)
                break
            case 'reportViewportSize':
                this.viewportSizes.set(varName, { width: msg.width, height: msg.height })
                break
        }
    }

    /**
     * Handles the webview's 'ready' signal by replaying cached state or requesting fresh data.
     * @param varName - The variable whose webview became ready.
     */
    private handleWebviewReady (varName: string): void {
        const cached = this.variableState.get(varName)
        if (cached != null && cached.rendererType === 'unsupported') {
            this.postToPanel(varName, {
                type: 'variableResponse',
                varName,
                metadata: cached.metadata,
                rendererType: cached.rendererType,
                preview: cached.preview
            })
        } else {
            this.service.sendRequest({ type: 'QueryVariable', varName })
            this.startRequestTimer(varName, 'QueryVariable')
        }

        const connected = this.mvm.getMatlabState() === MatlabMVMConnectionState.CONNECTED
        this.postToPanel(varName, { type: 'matlabState', connected, idle: connected })
    }

    // ── MATLAB Lifecycle ─────────────────────────────────────────────

    /**
     * Handles MATLAB connection state changes. Disposes all panels on disconnect.
     * @param newState - The new MATLAB connection state.
     */
    private onMatlabStateChanged (newState: MatlabMVMConnectionState): void {
        if (newState === MatlabMVMConnectionState.DISCONNECTED) {
            this.clearAllRequestTimers()
            for (const [, panel] of this.panels) {
                panel.dispose()
            }
            this.panels.clear()
            this.variableState.clear()
            this.viewportSizes.clear()
            this.panelVarNames.clear()
            this.pendingRenames.clear()
        }
    }

    /**
     * Broadcasts the current MATLAB connected/idle state to all open panels.
     * @param isIdle - Whether MATLAB is currently idle.
     */
    private broadcastMatlabState (isIdle: boolean): void {
        const connected = this.mvm.getMatlabState() === MatlabMVMConnectionState.CONNECTED
        for (const [varName] of this.panels) {
            this.postToPanel(varName, { type: 'matlabState', connected, idle: isIdle })
        }
    }

    /** Notifies visible grid panels of stale data, and re-queries visible unsupported panels. */
    private invalidateVisiblePanels (): void {
        for (const [varName, panel] of this.panels) {
            if (!panel.visible) continue

            const cached = this.variableState.get(varName)
            if (cached == null) continue

            if (cached.rendererType === 'grid') {
                this.postToPanel(varName, { type: 'dataStale' })
            } else {
                this.service.sendRequest({ type: 'QueryVariable', varName })
                this.startRequestTimer(varName, 'QueryVariable')
            }
        }
    }

    // ── Telemetry ────────────────────────────────────────────────────

    /**
     * Logs a vvScrolled telemetry event for the given variable.
     * @param varName - The variable whose panel received the scroll event.
     * @param scrollType - The dominant scroll direction reported by the webview.
     */
    private handleScrollTelemetry (varName: string, scrollType: 'horizontal' | 'vertical'): void {
        const cached = this.variableState.get(varName)
        if (cached == null) return

        if (scrollType === 'horizontal' && cached.loggedScrollH) return
        if (scrollType === 'vertical' && cached.loggedScrollV) return

        if (scrollType === 'horizontal') {
            cached.loggedScrollH = true
        } else {
            cached.loggedScrollV = true
        }

        this.telemetryLogger.logEvent({
            eventKey: 'ML_VS_CODE_ACTIONS',
            data: {
                action_type: 'vvScrolled',
                scrollType,
                elementId: getElementId(cached.metadata.dataType, cached.rendererType, cached.metadata.size),
                nameHash: hashVariableName(varName)
            }
        })
    }

    // ── Utilities ────────────────────────────────────────────────────

    /**
     * Tests whether a server error message indicates the variable no longer exists.
     * @param rawMessage - The raw error message from the server.
     * @returns True if the message indicates a missing variable.
     */
    private isVariableNotFoundError (rawMessage: string): boolean {
        const lower = rawMessage.toLowerCase()
        return lower.includes('undefined') || lower.includes('unrecognized') || lower.includes('not found')
    }

    /**
     * Translates a raw server error message into a user-friendly string.
     * @param varName - The variable the error pertains to.
     * @param rawMessage - The raw error message from the server.
     * @returns A user-facing error message.
     */
    private translateError (varName: string, rawMessage: string): string {
        if (this.isVariableNotFoundError(rawMessage)) {
            return `The variable '${varName}' does not exist.`
        }
        if (rawMessage.toLowerCase().includes('timeout') || rawMessage.toLowerCase().includes('timed out')) {
            return `The request for '${varName}' timed out.`
        }
        return `Unable to retrieve '${varName}'.`
    }

    /**
     * Starts a timeout timer for a pending request. If a response does not arrive
     * within REQUEST_TIMEOUT_MS, posts an error to the panel. Clears any existing
     * timer for the same variable first, so duplicate sends just reset the deadline.
     * @param varName - The variable the request targets.
     * @param requestType - The request type string included in the error message for diagnosis.
     */
    private startRequestTimer (varName: string, requestType: string): void {
        this.clearRequestTimer(varName)
        const timer = setTimeout(() => {
            this.requestTimers.delete(varName)
            this.postToPanel(varName, {
                type: 'error',
                varName,
                requestType,
                message: `No response received for '${varName}' (${requestType}) after ${REQUEST_TIMEOUT_MS / 1000}s`
            })
        }, REQUEST_TIMEOUT_MS)
        this.requestTimers.set(varName, timer)
    }

    /**
     * Clears the timeout timer for a variable if one is pending.
     * @param varName - The variable whose timer should be cancelled.
     */
    private clearRequestTimer (varName: string): void {
        const timer = this.requestTimers.get(varName)
        if (timer != null) {
            clearTimeout(timer)
            this.requestTimers.delete(varName)
        }
    }

    /** Clears all pending request timers. */
    private clearAllRequestTimers (): void {
        for (const timer of this.requestTimers.values()) {
            clearTimeout(timer)
        }
        this.requestTimers.clear()
    }

    /**
     * Posts a message to the webview panel for the given variable, if it exists.
     * @param varName - The variable whose panel should receive the message.
     * @param message - The message to post.
     */
    private postToPanel (varName: string, message: ExtToVVWebview): void {
        const panel = this.panels.get(varName)
        if (panel == null) return
        void panel.webview.postMessage(message)
    }

    /**
     * Updates the panel tab title to the variable name.
     * @param varName - The variable name.
     */
    private updatePanelTitle (varName: string): void {
        const panel = this.panels.get(varName)
        if (panel == null) return

        panel.title = varName
    }
}
