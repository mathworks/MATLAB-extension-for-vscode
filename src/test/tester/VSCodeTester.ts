// Copyright 2023 The MathWorks, Inc.

import * as vscode from 'vscode'
import * as path from 'path'
import * as extension from '../../extension'
import * as PollingUtils from './PollingUtils'

/**
 * Change 'MATLAB Connection' to connect to MATLAB
 */
export async function connectToMATLAB (): Promise<void> {
    extension.sendConnectionActionNotification('connect')
    return await assertMATLABConnected()
}

/**
 * Change 'MATLAB Connection' to disconnect from MATLAB
 */
export async function disconnectFromMATLAB (): Promise<void> {
    extension.sendConnectionActionNotification('disconnect')
    return await assertMATLABDisconnected()
}

/**
 * Get the status bar text to indicate if MATLAB connection
 */
export function _getConnectionStatus (): string {
    return extension?.connectionStatusNotification?.text
}

/**
 * Poll for MATLAB to connect to VSCode
 */
export async function assertMATLABConnected (): Promise<void> {
    return await PollingUtils.poll(_getConnectionStatus, extension.CONNECTION_STATUS_LABELS.CONNECTED, 'Expected MATLAB to be connected')
}

/**
 * Poll for MATLAB to disconnect from VSCode
 */
export async function assertMATLABDisconnected (): Promise<void> {
    return await PollingUtils.poll(_getConnectionStatus, extension.CONNECTION_STATUS_LABELS.NOT_CONNECTED, 'Expected MATLAB to be disconnected')
}

/**
 * Open a file from the 'test-files' directory
 */
export async function openDocument (fileName: string): Promise<vscode.TextEditor> {
    const filePath = path.resolve(__dirname, '../', './test-files', fileName)
    const document = await vscode.workspace.openTextDocument(filePath)
    return await vscode.window.showTextDocument(document)
}

/**
 * Open a new untitled buffer with language set to matlab
 */
export async function openNewDocument (): Promise<vscode.TextEditor> {
    const document = await vscode.workspace.openTextDocument({ language: 'matlab' })
    return await vscode.window.showTextDocument(document)
}

/**
 * Assert the content of the active VSCode document
 */
export async function assertActiveDocumentContent (content: string, message: string): Promise<void> {
    return await PollingUtils.poll(_getActiveDocumentContent, content, `Assertion on active document content: ${message}`)
}

/**
 * Get the content of the active document
 */
export function _getActiveDocumentContent (): string {
    let content = vscode.window.activeTextEditor?.document.getText() ?? ''
    content = content?.split('\r\n').join('\n')
    content = content?.split('\r').join('\n')
    return content
}

/**
 * Perform a format action on the active document
 */
export async function formatActiveDocument (): Promise<void> {
    return await vscode.commands.executeCommand('editor.action.formatDocument')
}

/**
 * Close the editor that is currently active
 */
export async function closeActiveDocument (): Promise<void> {
    return await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
}

/**
 * Closes all open editors
 */
export async function closeAllDocuments (): Promise<void> {
    return await vscode.commands.executeCommand('workbench.action.closeAllEditors')
}
