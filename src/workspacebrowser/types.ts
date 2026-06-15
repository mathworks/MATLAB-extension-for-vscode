// Copyright 2026 The MathWorks, Inc.

/**
 * Represents a single MATLAB workspace variable with its display properties.
 * The `name` field is always present for row identity (selection, patching, context menus).
 * All column values live in `fields`, keyed by original-case column name.
 */
export interface WorkspaceVariable {
    name: string
    fields: Record<string, string>
}

/**
 * Defines the display and behavior properties for a single table column.
 * Received from the MATLAB language server via the Columns message.
 */
export interface WorkspaceColumn {
    name: string
    label: string
    sortable: boolean
    resizable: boolean
}

/**
 * Persisted UI state that survives webview disposal and MATLAB reconnection.
 * Stored in vscode.ExtensionContext.workspaceState under the key 'wsb-state'.
 */
export interface SavedState {
    columnWidths?: Record<string, number>
    sortColumn?: string
    sortDirection?: 'asc' | 'desc'
}

/**
 * Messages sent from the extension host to the webview.
 * Discriminated union on the 'type' field for exhaustive switch handling.
 */
export type ExtToWebview =
    | { type: 'setData', rows: WorkspaceVariable[] }
    | { type: 'setColumns', columns: WorkspaceColumn[] }
    | { type: 'setState', state: SavedState }
    | { type: 'setTruncationInfo', displayedCount: number, totalCount: number }
    | { type: 'themeChanged' }
    | { type: 'operationError', operation: string, variable: string, message: string }
    | { type: 'sortFromContextMenu', column: string, direction: 'asc' | 'desc' }
    | { type: 'focusValueInput', variable: string }
    | { type: 'focusNameInput', variable: string }

/**
 * Messages sent from the webview to the extension host.
 * Discriminated union on the 'type' field for exhaustive switch handling.
 */
export type WebviewToExt =
    | { type: 'ready' }
    | { type: 'editValue', variable: string, newValue: string }
    | { type: 'renameVariable', variable: string, newName: string }
    | { type: 'deleteVariable', variable: string }
    | { type: 'stateChanged', state: SavedState }
    | { type: 'openMaxVariablesSetting' }
