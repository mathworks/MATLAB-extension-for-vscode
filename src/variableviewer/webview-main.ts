// Copyright 2026 The MathWorks, Inc.

/** Entry point for the Variable Viewer webview bundle. Bootstraps the PanelHost on load. */

import { PanelHost } from './webview-host'
import { VVWebviewToExt } from './types'

declare function acquireVsCodeApi (): { postMessage: (msg: VVWebviewToExt) => void }

const host = new PanelHost(acquireVsCodeApi())
host.init()
