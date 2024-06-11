// Copyright 2024 The MathWorks, Inc.

import * as vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node'
import Notification from './Notifications'

enum DeprecationType {
    NEVER_SUPPORTED = 1,
    DEPRECATED = 2,
    TO_BE_DEPRECATED = 3
}

interface PopupInfo {
    message: string
    options: string[]
}

interface MessageData {
    deprecationType: DeprecationType
    deprecationInfo: DeprecationInfo
}

interface DeprecationInfo {
    /**
     * The version of MATLAB which has been launched
     */
    matlabVersion: string

    /**
     * The minimum supported release of MATLAB (support may be ending soon)
     */
    minVersion: string

    /**
     * The future minimum supported release of MATLAB. This may be greater
     * than the `minVersion` if support for `minVersion` is planned to end.
     */
    futureMinVersion: string
}

interface StoredPopupConfig {
    /**
     * Contains saved config for when the popup should not be shown.
     */
    hidePopupFor: {
        /**
         * The deprecated releases of MATLAB for which the user has
         * chosen "Do not show again for <release>"
         */
        deprecated: string[]

        /**
         * The to-be-deprecated releases of MATLAB for which the user has
         * chosen "Do not show again for <release>"
         */
        toBeDeprecated: string[]
    }
}

const GLOBAL_STORAGE_KEY = 'matlab.deprecation.popup'

/**
 * Service to handle notifications from the MATLAB language server when a
 * launched MATLAB version is no longer supported (or is on a deprecation
 * track) by the language server.
 */
export default class DeprecationPopupService {
    constructor (private readonly context: vscode.ExtensionContext) {}

    /**
     * Initializes the service to listen to notifications from the language server.
     *
     * @param client The language server client
     */
    initialize (client: LanguageClient): void {
        this.context.subscriptions.push(
            client.onNotification(Notification.MatlabVersionDeprecation, (data: MessageData) => {
                this.showDeprecationPopup(data.deprecationType, data.deprecationInfo)
            }),
            vscode.commands.registerCommand('matlab.resetDeprecationPopups', () => {
                this.resetDeprecationPopupConfig()
            })
        )
    }

    /**
     * Attempts to display a deprecation notification popup.
     *
     * @see {@link shouldShowDeprecationPopup} for details on when the popup is shown.
     *
     * @param deprecationType The type of depreceation message (i.e. Deprecated,
     * Never Supported, or To-Be-Deprecated)
     * @param deprecationInfo Contains info about the current MATLAB version as well as
     * what versions are supported.
     */
    private showDeprecationPopup (deprecationType: DeprecationType, deprecationInfo: DeprecationInfo): void {
        if (!this.shouldShowDeprecationPopup(deprecationType, deprecationInfo)) {
            return
        }

        const { message, options } = this.getPopupInfo(deprecationType, deprecationInfo)

        switch (deprecationType) {
            case DeprecationType.TO_BE_DEPRECATED:
                void vscode.window.showWarningMessage(message, ...options).then(choice => {
                    this.handleChoiceClicked(deprecationType, deprecationInfo, choice)
                })
                break
            case DeprecationType.NEVER_SUPPORTED:
            case DeprecationType.DEPRECATED:
                void vscode.window.showErrorMessage(message, ...options).then(choice => {
                    this.handleChoiceClicked(deprecationType, deprecationInfo, choice)
                })
                break
        }
    }

    /**
     * Determines whether the deprecation popup should be shown. By default, the popup will
     * be shown. However, if the "Do not show again" option is clicked, the popup will not
     * be shown again in the future for this combination of deprecation type AND MATLAB version.
     *
     * @param deprecationType The type of depreceation message (i.e. Deprecated,
     * Never Supported, or To-Be-Deprecated)
     * @param deprecationInfo Contains info about the current MATLAB version as well as
     * what versions are supported.
     */
    private shouldShowDeprecationPopup (deprecationType: DeprecationType, deprecationInfo: DeprecationInfo): boolean {
        const config: StoredPopupConfig | undefined = this.context.globalState.get(GLOBAL_STORAGE_KEY)

        if (config === undefined) {
            // No saved config - show popup
            return true
        } else {
            const { matlabVersion } = deprecationInfo
            const isInDeprecated = config.hidePopupFor.deprecated.includes(matlabVersion)
            const isInToBeDeprecated = config.hidePopupFor.toBeDeprecated.includes(matlabVersion)

            if (deprecationType === DeprecationType.DEPRECATED && isInDeprecated) {
                return false
            } else if (deprecationType === DeprecationType.TO_BE_DEPRECATED && isInToBeDeprecated) {
                return false
            }
        }

        return true
    }

    /**
     * Gets the message and options to display on the popup.
     *
     * @param deprecationType The type of depreceation message (i.e. Deprecated,
     * Never Supported, or To-Be-Deprecated)
     * @param deprecationInfo Contains info about the current MATLAB version as well as
     * what versions are supported.
     */
    private getPopupInfo (deprecationType: DeprecationType, deprecationInfo: DeprecationInfo): PopupInfo {
        let message = ''
        const options = ['Dismiss']

        if (deprecationType === DeprecationType.NEVER_SUPPORTED) {
            message = `This extension does not support MATLAB ${deprecationInfo.matlabVersion}. To make use of the advanced features of the extension or run MATLAB code, you must have MATLAB ${deprecationInfo.minVersion} or later installed.`
        } else if (deprecationType === DeprecationType.DEPRECATED) {
            message = `This extension no longer supports MATLAB ${deprecationInfo.matlabVersion}. To make use of the advanced features of the extension or run MATLAB code, you must have MATLAB ${deprecationInfo.minVersion} or later installed.`
            options.push(`Do not show again for ${deprecationInfo.matlabVersion}`)
        } else if (deprecationType === DeprecationType.TO_BE_DEPRECATED) {
            message = `This extension will no longer support MATLAB ${deprecationInfo.matlabVersion} in a future release. To make use of the advanced features of the extension or run MATLAB code, you will need to have MATLAB ${deprecationInfo.futureMinVersion} or later installed.`
            options.push(`Do not show again for ${deprecationInfo.matlabVersion}`)
        }

        return {
            message,
            options
        }
    }

    /**
     * Handles the user's choice within the popup.
     *
     * @param deprecationType The type of depreceation message (i.e. Deprecated,
     * Never Supported, or To-Be-Deprecated)
     * @param deprecationInfo Contains info about the current MATLAB version as well as
     * what versions are supported.
     * @param choice the user's choice, or undefined if the user dismissed the popup without selecting an option
     */
    private handleChoiceClicked (deprecationType: DeprecationType, deprecationInfo: DeprecationInfo, choice?: string): void {
        if (choice == null) {
            return
        }

        if (choice?.startsWith('Do not show again for')) {
            // Need to update the stored config to hide this popup for this scenario
            let config: StoredPopupConfig | undefined = this.context.globalState.get(GLOBAL_STORAGE_KEY)

            if (config === undefined) {
                // No current config - need to create config object
                config = {
                    hidePopupFor: {
                        deprecated: [],
                        toBeDeprecated: []
                    }
                }
            }

            if (deprecationType === DeprecationType.DEPRECATED) {
                config.hidePopupFor.deprecated.push(deprecationInfo.matlabVersion)
            } else if (deprecationType === DeprecationType.TO_BE_DEPRECATED) {
                config.hidePopupFor.toBeDeprecated.push(deprecationInfo.matlabVersion)
            }

            void this.context.globalState.update(GLOBAL_STORAGE_KEY, config)
        }
    }

    /**
     * Resets the stored configuration for the deprecation popups, allowing
     * them to appear again.
     */
    private resetDeprecationPopupConfig (): void {
        void this.context.globalState.update(GLOBAL_STORAGE_KEY, undefined)
    }
}
