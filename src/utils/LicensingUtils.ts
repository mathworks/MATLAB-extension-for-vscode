// Copyright 2024 The MathWorks, Inc.

import * as vscode from 'vscode'
import { openUrlInExternalBrowser } from './BrowserUtils'
import Notification from '../Notifications'
import { LanguageClient } from 'vscode-languageclient/node';

let minimalLicensingInfo: string = ''
let licensingUrlNotificationListener: vscode.Disposable | undefined
let licensingDataNotificationListener: vscode.Disposable | undefined
let licensingErrorNotificationListener: vscode.Disposable | undefined

let isInitialized = false;

export const LICENSING_SETTING_NAME: string = 'signIn'

/**
 * Gets the minimal licensing information as a string.
 * @returns {string} The minimal licensing information.
 */
export function getMinimalLicensingInfo (): string {
    return minimalLicensingInfo
}

/**
 * Sets up the licensing notification listeners for the extension.
 *
 * @param client - The language client instance.
 */
export function setupLicensingListeners (client: LanguageClient): void {
    if (!isInitialized) {
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        licensingUrlNotificationListener = client.onNotification(Notification.LicensingServerUrl, async (url: string) => {
            const result = await vscode.window.showInformationMessage(
                'Sign in required to open MATLAB. Click OK to open your system browser and sign in.',
                'OK'
            );

            if (result === 'OK') {
                void openUrlInExternalBrowser(url);
            }
        })
        licensingDataNotificationListener = client.onNotification(Notification.LicensingData, (data: string) => {
            minimalLicensingInfo = data
        })
        licensingErrorNotificationListener = client.onNotification(Notification.LicensingError, (data: string) => handleLicensingError(data))
        isInitialized = true;
    }
}

/**
 * Removes the licensing notification listeners for the extension.
 */
export function removeLicensingListeners (): void {
    if (isInitialized) {
        licensingUrlNotificationListener?.dispose();
        licensingUrlNotificationListener = undefined;

        licensingDataNotificationListener?.dispose();
        licensingDataNotificationListener = undefined;

        licensingErrorNotificationListener?.dispose();
        licensingErrorNotificationListener = undefined;

        isInitialized = false;
    }
}

/**
 * Handles the licensing error notification by displaying an information message.
 *
 * @param data - The error message data.
 */
function handleLicensingError (data: string): void {
    void vscode.window.showErrorMessage(`Licensing failed with error: ${data}`)
}

/**
 * Returns true if the SignIn setting is enabled.
 */
export function isSignInSettingEnabled (): boolean {
    return vscode.workspace.getConfiguration('MATLAB').get(LICENSING_SETTING_NAME) as boolean
}
