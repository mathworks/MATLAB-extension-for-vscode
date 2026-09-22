// Copyright 2026 The MathWorks, Inc.

import { ContentRenderer, ExtToVVWebview, VVWebviewToExt } from './types'

interface VsCodeApi { postMessage: (msg: VVWebviewToExt) => void }

/**
 * Fallback renderer for variable types not supported by the grid (e.g. structs, cell arrays).
 * Displays MATLAB Command Window output for the variable.
 */
export class UnsupportedRenderer implements ContentRenderer {
    private container: HTMLElement | null = null
    private previewText: HTMLPreElement | null = null

    constructor (
        private readonly _api: VsCodeApi,
        private varName: string
    ) {}

    mount (container: HTMLElement): void {
        this.container = container
        container.innerHTML = `
            <div class="vv-preview-wrap">
                <pre class="vv-preview-text"></pre>
            </div>
        `
        this.previewText = container.querySelector('.vv-preview-text') as HTMLPreElement
        this.previewText.setAttribute('aria-label', 'MATLAB Command Window output for ' + this.varName)
    }

    handleMessage (msg: ExtToVVWebview): void {
        switch (msg.type) {
            case 'variableResponse':
                if (msg.preview != null && this.previewText != null) {
                    this.previewText.textContent = msg.preview
                }
                break
        }
    }

    setVarName (newName: string): void {
        this.varName = newName
        if (this.previewText != null) {
            this.previewText.setAttribute('aria-label', 'MATLAB Command Window output for ' + newName)
        }
    }

    onMatlabState (_connected: boolean, _idle: boolean): void {
        // Unsupported renderer has no MATLAB state behavior
    }

    dispose (): void {
        if (this.container != null) {
            this.container.innerHTML = ''
        }
        this.container = null
        this.previewText = null
    }
}
