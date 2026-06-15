// Copyright 2026 The MathWorks, Inc.

// Thin webpack entry point that separates the production bootstrap from the testable module.
// Tests import webview.ts directly and inject a mock API via init().

import { init } from './webview'
import { WebviewToExt } from './types'

declare function acquireVsCodeApi (): { postMessage: (msg: WebviewToExt) => void }

init(acquireVsCodeApi())
