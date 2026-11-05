// Copyright 2026 The MathWorks, Inc.

/** Entry point for the Variable Viewer webview bundle. Bootstraps the PanelHost on load. */

import { PanelHost } from './webview-host'
import { VVWebviewToExt, GridViewState } from './types'

declare function acquireVsCodeApi (): {
    postMessage: (msg: VVWebviewToExt) => void
    getState: () => GridViewState | null
    setState: (state: GridViewState | null) => void
}

const host = new PanelHost(acquireVsCodeApi())
host.init()
