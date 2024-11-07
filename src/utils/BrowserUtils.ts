// Copyright 2024 The MathWorks, Inc.

import * as vscode from 'vscode'

/**
 * Opens the provided URL in an external browser.
 * If the URL fails to open in the browser, it renders the URL inside a VS Code webview panel.
 * @param url - The URL to open.
 * @returns A Promise that resolves when the URL is opened or rendered.
 */
export async function openUrlInExternalBrowser (url: string): Promise<void> {
    const parsedUrl = vscode.Uri.parse(url)
    // This is a no-op if the extension is running on the client machine.
    let externalUri = await vscode.env.asExternalUri(parsedUrl)

    // In remote environments (ie. codespaces) asExternalUri() removes path and query fields in the vscode.Uri object
    // So, reinitialize it with required fields.
    externalUri = externalUri.with({ path: parsedUrl.path, query: parsedUrl.query })

    const success = await vscode.env.openExternal(externalUri);
    // Render inside vscode's webview if the url fails to open in the browser.
    if (!success) {
        void vscode.window.showWarningMessage('Failed to open licensing server url in browser. Opening it within vs code.')
        const panel = vscode.window.createWebviewPanel('matlabLicensing', 'MATLAB Licensing', vscode.ViewColumn.Active, { enableScripts: true });

        panel.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Webview Example</title>
            <style>
                body, html, iframe {
                    margin: 0;
                    padding: 0;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    border: none;
                }
            </style>
        </head>
        <body>
        <iframe src="${externalUri.toString(true)}"></iframe>
        </body>
        </html>
    `;
    }
}
