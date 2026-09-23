// Copyright 2026 The MathWorks, Inc.

import { ContentRenderer, ExtToVVWebview, VVWebviewToExt, VariableMetadata, RendererType } from './types'
import { GridRenderer } from './webview-grid'
import { UnsupportedRenderer } from './webview-unsupported'

interface VsCodeApi { postMessage: (msg: VVWebviewToExt) => void }

/**
 * Top-level host running inside the Variable Viewer webview.
 * Manages the banner, loading state, renderer lifecycle, and message routing
 * between the extension host and the active ContentRenderer.
 */
export class PanelHost {
    private varName: string
    private contentRoot: HTMLElement | null = null
    private bannerName: HTMLElement | null = null
    private bannerMeta: HTMLElement | null = null
    private currentRenderer: ContentRenderer | null = null
    private currentRendererType: RendererType | null = null
    private matlabConnected: boolean = false
    private matlabIdle: boolean = false

    /** @param api - The VS Code webview API for posting messages back to the extension host. */
    constructor (private readonly api: VsCodeApi) {
        this.varName = document.body.dataset.varName ?? ''
    }

    /** Locates DOM elements, shows the loading spinner, registers the message listener, and signals readiness. */
    init (): void {
        this.contentRoot = document.querySelector('.vv-content-root') as HTMLElement
        this.bannerName = document.querySelector('.vv-banner-name') as HTMLElement
        this.bannerMeta = document.querySelector('.vv-banner-meta') as HTMLElement

        this.contentRoot.setAttribute('aria-busy', 'true')
        this.contentRoot.innerHTML = '<div class="vv-loading"><div class="vv-spinner"></div></div>'

        window.addEventListener('message', (e: MessageEvent) => {
            this.handleMessage(e.data as ExtToVVWebview)
        })

        this.api.postMessage({ type: 'ready' })
    }

    /**
     * Dispatches an incoming message from the extension host to the appropriate handler
     * or forwards it to the active content renderer.
     * @param msg - The message posted from the extension host.
     */
    handleMessage (msg: ExtToVVWebview): void {
        switch (msg.type) {
            case 'variableResponse':
                this.onVariableResponse(msg)
                break
            case 'variableDeleted':
                this.onVariableDeleted(msg.varName)
                break
            case 'variableRenamed':
                this.onVariableRenamed(msg.newName)
                break
            case 'matlabState':
                this.matlabConnected = msg.connected
                this.matlabIdle = msg.idle
                if (this.currentRenderer != null) {
                    this.currentRenderer.onMatlabState(msg.connected, msg.idle)
                }
                break
            case 'error':
                if (this.currentRenderer != null) {
                    this.currentRenderer.handleMessage(msg)
                } else {
                    this.showLoadingError(msg.message)
                }
                break
            case 'themeChanged':
                break
            default:
                if (this.currentRenderer != null) {
                    this.currentRenderer.handleMessage(msg)
                }
                break
        }
    }

    /**
     * Handles a variable response by updating the banner, switching renderers if needed,
     * and forwarding the message to the active renderer.
     * @param msg - The variable response message containing metadata and optional cell data.
     */
    private onVariableResponse (msg: Extract<ExtToVVWebview, { type: 'variableResponse' }>): void {
        if (this.contentRoot != null) {
            this.contentRoot.setAttribute('aria-busy', 'false')
        }
        if (msg.metadata != null) {
            this.updateBanner(msg.metadata)
        }

        const neededType: RendererType = msg.rendererType

        if (neededType !== this.currentRendererType) {
            this.switchRenderer(neededType)
        }

        this.currentRenderer!.handleMessage(msg)
    }

    /**
     * Disposes the current renderer and replaces it with a new one of the given type.
     * @param type - The renderer type to switch to.
     */
    private switchRenderer (type: RendererType): void {
        if (this.currentRenderer != null) {
            this.currentRenderer.dispose()
        }

        const renderer = this.createRenderer(type)
        if (this.contentRoot != null) {
            renderer.mount(this.contentRoot)
        }
        renderer.onMatlabState(this.matlabConnected, this.matlabIdle)
        this.currentRenderer = renderer
        this.currentRendererType = type
    }

    /**
     * Factory method that instantiates the appropriate ContentRenderer for the given type.
     * @param type - The renderer type to create.
     * @returns A new ContentRenderer instance.
     */
    private createRenderer (type: RendererType): ContentRenderer {
        switch (type) {
            case 'grid':
                return new GridRenderer(this.api, this.varName)
            case 'unsupported':
                return new UnsupportedRenderer(this.api, this.varName)
        }
    }

    /**
     * Handles variable deletion by disposing the renderer and showing the "not found" message.
     * @param deletedVarName - The name of the variable that was deleted.
     */
    private onVariableDeleted (deletedVarName: string): void {
        if (this.currentRenderer != null) {
            this.currentRenderer.dispose()
            this.currentRenderer = null
            this.currentRendererType = null
        }
        if (this.contentRoot != null) {
            this.contentRoot.innerHTML = `<div class="vv-deleted-message" role="status">
                <h3>Variable Not Found</h3>
                <p>The variable '${this.escapeHtml(deletedVarName)}' does not exist.</p>
            </div>`
        }
    }

    /**
     * Replaces the loading spinner with an error message when a request fails before a renderer is created.
     * @param message - The error message to display.
     */
    private showLoadingError (message: string): void {
        if (this.contentRoot != null) {
            this.contentRoot.setAttribute('aria-busy', 'false')
            this.contentRoot.innerHTML = `<div class="vv-loading-error" role="status">
                <p>${this.escapeHtml(message)}</p>
            </div>`
        }
    }

    /**
     * Handles a variable rename by updating the name used for outgoing messages and the banner.
     * @param newName - The new variable name after the rename.
     */
    private onVariableRenamed (newName: string): void {
        this.varName = newName
        if (this.bannerName != null) {
            this.bannerName.textContent = newName
        }
        if (this.currentRenderer != null) {
            this.currentRenderer.setVarName(newName)
        }
    }

    /**
     * Updates the banner bar with the variable name, dimensions, and data type.
     * @param metadata - The variable's metadata containing size and type info.
     */
    private updateBanner (metadata: VariableMetadata): void {
        if (this.bannerName == null || this.bannerMeta == null) return
        this.bannerName.textContent = this.varName
        const sizeStr = metadata.size.join('x')
        this.bannerMeta.textContent = `${sizeStr} ${metadata.dataType}`
    }

    /**
     * Escapes special HTML characters to prevent XSS in dynamically generated content.
     * @param text - The raw string to escape.
     * @returns The HTML-safe escaped string.
     */
    private escapeHtml (text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
    }
}
