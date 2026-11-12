// Copyright 2026 The MathWorks, Inc.

import { GridViewState, RestoredGridViewState, VariableMetadata, VVWebviewToExt } from '../types'
import { ColumnLayout } from './ColumnLayout'
import { SelectionModel } from './SelectionModel'

interface VsCodeApi {
    postMessage: (msg: VVWebviewToExt) => void
    getState: () => GridViewState | null
    setState: (state: GridViewState | null) => void
}

const SAVE_DEBOUNCE_MS: number = 300

/**
 * Manages persistence of the grid view state across webview hide/show cycles
 * using the VS Code webview state API.
 */
export class ViewStateManager {
    private debounceTimer: ReturnType<typeof setTimeout> | undefined

    constructor (
        private readonly api: VsCodeApi,
        private readonly selectionModel: SelectionModel,
        private readonly columnLayout: ColumnLayout,
        private readonly scrollContainer: HTMLElement
    ) {}

    /**
     * Persists the current grid state (scroll position, selection, column widths, data class) to the webview state store.
     * @param metadata - The current variable metadata, used to tag the saved state with the data class.
     */
    save (metadata: VariableMetadata): void {
        const selected = this.selectionModel.getSelected()
        const state: GridViewState = {
            matlabClass: metadata.dataType,
            viewport: {
                scroll: {
                    scrollTop: this.scrollContainer.scrollTop,
                    scrollLeft: this.scrollContainer.scrollLeft
                },
                selection: selected != null ? { row: selected.row, col: selected.col } : null
            },
            columnWidths: this.columnLayout.getAdjustments()
        }
        this.api.setState(state)
    }

    /**
     * Retrieves and validates saved state against the current variable metadata.
     * A class change discards everything; a selection that no longer fits discards only the viewport.
     * @param metadata - The current variable metadata to validate against.
     * @returns The applicable parts of the saved state, or null if nothing applies.
     */
    restore (metadata: VariableMetadata): RestoredGridViewState | null {
        const saved = this.api.getState()
        if (saved == null) return null

        if (saved.matlabClass !== metadata.dataType) {
            this.clear()
            return null
        }

        const selection = saved.viewport.selection
        const rows = metadata.size[0] ?? 0
        const cols = metadata.size[1] ?? 1
        const selectionFits = selection == null || (selection.row <= rows && selection.col <= cols)

        return {
            viewport: selectionFits ? saved.viewport : null,
            columnWidths: saved.columnWidths
        }
    }

    /** Clears any persisted state from the webview state store. */
    clear (): void {
        this.api.setState(null)
    }

    /**
     * Schedules a debounced save to collapse rapid scroll, selection, and resize events into a single write.
     * @param metadata - The current variable metadata.
     */
    scheduleSave (metadata: VariableMetadata): void {
        if (this.debounceTimer != null) {
            clearTimeout(this.debounceTimer)
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined
            this.save(metadata)
        }, SAVE_DEBOUNCE_MS)
    }

    /** Cancels any pending debounced save. */
    dispose (): void {
        if (this.debounceTimer != null) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = undefined
        }
    }
}
