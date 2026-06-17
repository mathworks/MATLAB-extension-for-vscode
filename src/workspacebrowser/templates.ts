// Copyright 2026 The MathWorks, Inc.

import * as vscode from 'vscode'

export const WSB_MINIMUM_RELEASE = 'R2023a'

export function getUnsupportedHtml (): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Workspace</title>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         padding: 20px; text-align: center; }
  .unsupported-message { margin-top: 50px; }
  .status-icon { font-size: 48px; margin-bottom: 20px; opacity: 0.5; }
</style></head>
<body>
  <div class="unsupported-message">
    <div class="status-icon">⚠️</div>
    <h3>MATLAB Version Not Supported</h3>
    <p>The Workspace panel requires MATLAB <b>${WSB_MINIMUM_RELEASE}</b> or later.</p>
    <p>Please upgrade your MATLAB installation to use this feature.</p>
  </div>
</body></html>`
}

export function getDisconnectedHtml (): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Workspace</title>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         padding: 20px; text-align: center; }
  .disconnected-message { margin-top: 50px; }
  .status-icon { font-size: 48px; margin-bottom: 20px; opacity: 0.5; }
</style></head>
<body>
  <div class="disconnected-message">
    <div class="status-icon">⚠️</div>
    <h3>MATLAB Disconnected</h3>
    <p>The workspace browser is not available because MATLAB is not connected.</p>
    <p>Connect to MATLAB to view workspace variables.</p>
  </div>
</body></html>`
}

// Generates the full interactive HTML for the webview when MATLAB is connected and supported
export function getWebviewHtml (webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const stylesUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'out', 'workspacebrowser', 'resources', 'webview.css')
    )
    const bundleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'out', 'bundle.js')
    )
    const iconsBaseUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'out', 'workspacebrowser', 'resources')
    )

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workspace</title>
  <link rel="stylesheet" href="${stylesUri.toString()}">
</head>
<body data-icons-base-uri="${iconsBaseUri.toString()}" data-vscode-context='{"preventDefaultContextMenuItems":true}'>
  <div class="wsb-container">
    <div class="wsb-table-wrap">
      <table class="wsb-table">
        <thead></thead>
        <tbody></tbody>
      </table>
    </div>
    <div class="wsb-status-bar" style="display:none"></div>
  </div>
  <script src="${bundleUri.toString()}"></script>
</body>
</html>`
}
