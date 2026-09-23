// Copyright 2026 The MathWorks, Inc.

import * as vscode from 'vscode'

/**
 * Generates the shell HTML for a Variable Viewer webview panel.
 * Provides the banner, content root, and script/style links; the active ContentRenderer
 * populates content-specific DOM dynamically after mount.
 * @param webview - The VS Code Webview instance to generate resource URIs for.
 * @param extensionUri - Root URI of the extension, used to resolve resource paths.
 * @param varName - The MATLAB variable name to display in the panel title.
 * @returns A complete HTML document string ready to assign to `webview.html`.
 */
export function getVariableViewerHtml (webview: vscode.Webview, extensionUri: vscode.Uri, varName: string): string {
    const stylesUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'out', 'variableviewer', 'resources', 'webview.css')
    )
    const gridCssUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'out', 'variableviewer', 'resources', 'grid.css')
    )
    const unsupportedCssUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'out', 'variableviewer', 'resources', 'unsupported.css')
    )
    const bundleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'out', 'vv-bundle.js')
    )

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(varName)}</title>
  <link rel="stylesheet" href="${stylesUri.toString()}">
  <link rel="stylesheet" href="${gridCssUri.toString()}">
  <link rel="stylesheet" href="${unsupportedCssUri.toString()}">
</head>
<body data-var-name="${escapeHtml(varName)}" data-vscode-context='{"preventDefaultContextMenuItems":true}'>
  <main class="vv-container">
    <div class="vv-banner">
      <span class="vv-banner-name"></span>
      <span class="vv-banner-meta"></span>
    </div>
    <div class="vv-content-root"></div>
  </main>
  <script src="${bundleUri.toString()}"></script>
</body>
</html>`
}

/**
 * Escapes special HTML characters to prevent XSS when embedding variable names in HTML.
 * @param text - The raw string to escape.
 * @returns The escaped string safe for use in HTML attributes and content.
 */
function escapeHtml (text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}
