// Copyright 2026 The MathWorks, Inc.

// ── Shared Data Structures ──────────────────────────────────────

/** Identifies a named row or column in a MATLAB variable (e.g. table variable names, row names). */
export interface LabelInfo {
    readonly id: string
    readonly name: string
}

/** Describes the shape and classification of a MATLAB workspace variable. */
export interface VariableMetadata {
    dataType: string
    size: readonly number[]
    isSparse: boolean
    isTall: boolean
}

/** Column label metadata for a variable with named columns (e.g. table variable names). */
export interface VariableColumns {
    labels?: readonly LabelInfo[]
}

/** Row label metadata for a variable with named rows (e.g. table row names). */
export interface VariableRows {
    labels?: readonly LabelInfo[]
}

/** A rectangular page of cell string values returned by the server, anchored at a row/col origin. */
export interface CellPage {
    data: ReadonlyArray<readonly string[]>
    startRow: number
    startCol: number
}

// ── Extension Host → Server (via VVClientMessage notification) ──

/** Requests that the extension host can send to the MATLAB language server. */
export type VVClientRequest =
    | { type: 'QueryVariable', varName: string }
    | { type: 'QueryPage', varName: string, startRow: number, startCol: number }

// ── Server → Extension Host (via VVServerMessage notification) ──

/** Responses the MATLAB language server sends back to the extension host. */
export type VVServerResponse =
    | { type: 'VariableResponse', varName: string, metadata: VariableMetadata, columns?: VariableColumns, rows?: VariableRows, cells?: CellPage, preview?: string }
    | { type: 'VariableChanged', varName: string, className: string, size: readonly number[] }
    | { type: 'VariableDeleted', varName: string }
    | { type: 'Error', varName: string, requestType: string, message: string }

// ── Extension Host → Webview ────────────────────────────────────

/** Messages the extension host posts to the Variable Viewer webview. */
export type ExtToVVWebview =
    | { type: 'variableResponse', varName: string, metadata: VariableMetadata, columns?: VariableColumns, rows?: VariableRows, rendererType: RendererType, cells?: CellPage, preview?: string }
    | { type: 'variableChanged', varName: string, metadata: VariableMetadata }
    | { type: 'variableDeleted', varName: string }
    | { type: 'variableRenamed', oldName: string, newName: string }
    | { type: 'dataStale' }
    | { type: 'error', varName: string, requestType: string, message: string }
    | { type: 'matlabState', connected: boolean, idle: boolean }
    | { type: 'themeChanged' }

// ── Webview → Extension Host ────────────────────────────────────

/** Messages the webview posts back to the extension host in response to user interaction. */
export type VVWebviewToExt =
    | { type: 'ready' }
    | { type: 'requestPage', varName: string, startRow: number, startCol: number }
    | { type: 'scrolled', scrollType: 'horizontal' | 'vertical' }
    | { type: 'reportViewportSize', width: number, height: number }

// ── Workspace Refresh Contract ──────────────────────────────────

/** Lightweight summary of a workspace variable, emitted by the Workspace Browser after a refresh. */
export interface WorkspaceVariableSummary {
    name: string
    className: string
    size: string
}

// ── Renderer Classification ────────────────────────────────────

/** Determines which content renderer is used to display a variable in the webview. */
export type RendererType = 'grid' | 'unsupported'

// ── Content Renderer Contract ──────────────────────────────────

/**
 * Contract for a pluggable content renderer inside the Variable Viewer webview.
 * Each renderer owns its own DOM subtree within the content root and handles
 * messages relevant to its display mode.
 */
export interface ContentRenderer {
    /**
     * Creates the renderer's DOM structure inside the given container element.
     * @param container - The parent element that the renderer should populate.
     */
    mount: (container: HTMLElement) => void

    /**
     * Handles an incoming message from the extension host.
     * @param msg - The message dispatched by the PanelHost.
     */
    handleMessage: (msg: ExtToVVWebview) => void

    /**
     * Updates the variable name this renderer uses for outgoing messages and ARIA labels.
     * @param newName - The new variable name after a rename.
     */
    setVarName: (newName: string) => void

    /**
     * Notifies the renderer of a change in MATLAB connection or idle state.
     * @param connected - Whether MATLAB is currently connected.
     * @param idle - Whether MATLAB is idle (not executing a command).
     */
    onMatlabState: (connected: boolean, idle: boolean) => void

    /** Tears down event listeners and clears DOM nodes owned by this renderer. */
    dispose: () => void
}

// ── Constants ───────────────────────────────────────────────────

/** MATLAB class names that can be displayed using the virtual grid renderer. */
export const SUPPORTED_NUMERIC_CLASSES: ReadonlySet<string> = new Set([
    'double', 'single',
    'int8', 'int16', 'int32', 'int64',
    'uint8', 'uint16', 'uint32', 'uint64',
    'logical'
])

/** MATLAB class names that produce tabular data viewable in the grid renderer. */
export const SUPPORTED_TABULAR_CLASSES: ReadonlySet<string> = new Set([
    'table'
])
