// Copyright 2022 - 2024 The MathWorks, Inc.

import * as path from 'path'
import * as vscode from 'vscode'
import {
    LanguageClient, LanguageClientOptions, ServerOptions, TransportKind
} from 'vscode-languageclient/node'
import NotificationConstants from './NotificationConstants'
import TelemetryLogger, { TelemetryEvent } from './telemetry/TelemetryLogger'
import { MVM } from './commandwindow/MVM'
import { Notifier, MultiClientNotifier } from './commandwindow/Utilities'
import TerminalService from './commandwindow/TerminalService'
import Notification from './Notifications'
import ExecutionCommandProvider from './commandwindow/ExecutionCommandProvider'
import * as LicensingUtils from './utils/LicensingUtils'
import DeprecationPopupService from './DeprecationPopupService'
import SectionStylingService from './styling/SectionStylingService'
import MatlabDebugger from './debug/MatlabDebugger'

let client: LanguageClient
const OPEN_SETTINGS_ACTION = 'workbench.action.openSettings'
const MATLAB_INSTALL_PATH_SETTING = 'matlab.installPath'

export const CONNECTION_STATUS_LABELS = {
    CONNECTED: 'MATLAB: Connected',
    NOT_CONNECTED: 'MATLAB: Not Connected',
    CONNECTING: 'MATLAB: Establishing Connection'
}
const CONNECTION_STATUS_COMMAND = 'matlab.changeMatlabConnection'
export let connectionStatusNotification: vscode.StatusBarItem

// Command to enable or disable Sign In options for MATLAB
const MATLAB_ENABLE_SIGN_IN_COMMAND = 'matlab.enableSignIn'

let telemetryLogger: TelemetryLogger

let deprecationPopupService: DeprecationPopupService

let sectionStylingService: SectionStylingService;

let mvm: MVM;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let matlabDebugger: MatlabDebugger;
let terminalService: TerminalService;
let executionCommandProvider: ExecutionCommandProvider;

export async function activate (context: vscode.ExtensionContext): Promise<void> {
    // Initialize telemetry logger
    telemetryLogger = new TelemetryLogger(context.extension.packageJSON.version)
    telemetryLogger.logEvent({
        eventKey: 'ML_VS_CODE_ENVIRONMENT',
        data: {
            machine_hash: vscode.env.machineId,
            locale: vscode.env.language,
            os_platform: process.platform,
            vs_code_version: vscode.version
        }
    })

    // Set up status bar indicator
    connectionStatusNotification = vscode.window.createStatusBarItem()
    connectionStatusNotification.text = CONNECTION_STATUS_LABELS.NOT_CONNECTED
    connectionStatusNotification.command = CONNECTION_STATUS_COMMAND
    connectionStatusNotification.show()

    context.subscriptions.push(connectionStatusNotification)
    context.subscriptions.push(vscode.commands.registerCommand(CONNECTION_STATUS_COMMAND, () => handleChangeMatlabConnection()))
    // Event handler when VSCode configuration is changed by the user and executes corresponding functions for specific settings.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => {
        const configuration = vscode.workspace.getConfiguration('MATLAB')

        // Updates the licensing status bar item and listeners based on the 'signIn' setting.
        if (configuration.get<boolean>(LicensingUtils.LICENSING_SETTING_NAME) ?? false) {
            LicensingUtils.setupLicensingListeners(client)
        } else {
            LicensingUtils.removeLicensingListeners()
        }
    }))

    // Set up langauge server
    const serverModule: string = context.asAbsolutePath(
        path.join('server', 'out', 'index.js')
    )

    const args = getServerArgs(context)

    const serverOptions: ServerOptions = {
        run: {
            module: serverModule,
            transport: TransportKind.ipc,
            args
        },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: {
                // --inspect=6009: runs the server in Node's Inspector mode so
                // Visual Studio® Code can attach to the server for debugging
                execArgv: ['--nolazy', '--inspect=6009']
            },
            args
        }
    }

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for plain text documents
        documentSelector: ['matlab']
    }

    // Create and start the language client
    client = new LanguageClient(
        'matlabls',
        'MATLAB Language Server',
        serverOptions,
        clientOptions
    )

    // Set up notification listeners
    client.onNotification(Notification.MatlabConnectionServerUpdate, (data: { connectionStatus: string }) => handleConnectionStatusChange(data))
    client.onNotification(Notification.MatlabLaunchFailed, () => handleMatlabLaunchFailed())
    client.onNotification(Notification.MatlabFeatureUnavailable, () => handleFeatureUnavailable())
    client.onNotification(Notification.MatlabFeatureUnavailableNoMatlab, () => handleFeatureUnavailableWithNoMatlab())
    client.onNotification(Notification.LogTelemetryData, (data: TelemetryEvent) => handleTelemetryReceived(data))

    const multiclientNotifier = new MultiClientNotifier(client as Notifier);
    mvm = new MVM(multiclientNotifier);
    terminalService = new TerminalService(multiclientNotifier, mvm);
    executionCommandProvider = new ExecutionCommandProvider(mvm, terminalService, telemetryLogger);
    matlabDebugger = new MatlabDebugger(mvm, multiclientNotifier, telemetryLogger);

    context.subscriptions.push(vscode.commands.registerCommand('matlab.runFile', async () => await executionCommandProvider.handleRunFile()))
    context.subscriptions.push(vscode.commands.registerCommand('matlab.runSelection', async () => await executionCommandProvider.handleRunSelection()))
    context.subscriptions.push(vscode.commands.registerCommand('matlab.interrupt', () => executionCommandProvider.handleInterrupt()))
    context.subscriptions.push(vscode.commands.registerCommand('matlab.openCommandWindow', async () => await terminalService.openTerminalOrBringToFront()))
    context.subscriptions.push(vscode.commands.registerCommand('matlab.addFolderToPath', async (uri: vscode.Uri) => await executionCommandProvider.handleAddFolderToPath(uri)))
    context.subscriptions.push(vscode.commands.registerCommand('matlab.addFolderAndSubfoldersToPath', async (uri: vscode.Uri) => await executionCommandProvider.handleAddFolderAndSubfoldersToPath(uri)))
    context.subscriptions.push(vscode.commands.registerCommand('matlab.changeDirectory', async (uri: vscode.Uri) => await executionCommandProvider.handleChangeDirectory(uri)))
    context.subscriptions.push(vscode.commands.registerCommand('matlab.openFile', async (uri: vscode.Uri) => await executionCommandProvider.handleOpenFile(uri)))

    // Register a custom command which allows the user enable / disable Sign In options.
    // Using this custom command would be an alternative approach to going to enabling the setting.
    context.subscriptions.push(vscode.commands.registerCommand(MATLAB_ENABLE_SIGN_IN_COMMAND, async () => await handleEnableSignIn()))

    // Setup listeners only if licensing workflows are enabled.
    // Any further changes to the configuration settings will be handled by configChangeListener.
    if (LicensingUtils.isSignInSettingEnabled()) {
        LicensingUtils.setupLicensingListeners(client)
    }

    deprecationPopupService = new DeprecationPopupService(context)
    deprecationPopupService.initialize(client)

    sectionStylingService = new SectionStylingService(context)
    sectionStylingService.initialize(client);

    await client.start()
}

/**
 * Handles enabling MATLAB licensing workflows.
 *
 * Checks if the `signIn` setting is enabled. If it is not enabled,
 * updates the setting to enable it and displays a message indicating the workflows
 * have been enabled. If it is already enabled, displays a message indicating that.
 *
 * @param context - The context in which the extension is running.
 * @returns A promise that resolves when the operation is complete.
 */
async function handleEnableSignIn (): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('MATLAB');
    const enable = 'Enable'
    const disable = 'Disable';

    const choices = LicensingUtils.isSignInSettingEnabled() ? [disable] : [enable]

    const choice = await vscode.window.showQuickPick(choices, {
        placeHolder: 'Manage Sign In Options'
    })

    if (choice == null) {
        return
    }

    if (choice === 'Enable') {
        await configuration.update(LicensingUtils.LICENSING_SETTING_NAME, true, vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage('Sign In Options enabled.')
    } else if (choice === 'Disable') {
        await configuration.update(LicensingUtils.LICENSING_SETTING_NAME, false, vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage('Sign In Options disabled.')
    }
}

/**
 * Handles user input about whether to connect or disconnect from MATLAB®
 */
function handleChangeMatlabConnection (): void {
    const connect = 'Connect to MATLAB';
    const disconnect = 'Disconnect from MATLAB';
    const options = [connect, disconnect]

    const isSignInEnabled = LicensingUtils.isSignInSettingEnabled()
    const signOut = 'Sign Out of MATLAB'
    const isLicensed = LicensingUtils.getMinimalLicensingInfo() !== ''
    const isMatlabConnecting = connectionStatusNotification.text === CONNECTION_STATUS_LABELS.CONNECTING

    // Only show signout option when signin setting is enabled, MATLAB is connected and is licensed
    if (isSignInEnabled && isLicensed && isMatlabConnected()) {
        options.push(signOut)
    }

    void vscode.window.showQuickPick(options, {
        placeHolder: 'Change MATLAB Connection'
    }).then(choice => {
        if (choice == null) {
            return
        }

        if (choice === connect) {
            // Opens the browser tab with licensing URL.
            // This will only occur when the tab is accidentally closed by the user and wants to
            // connect to MATLAB
            if (isSignInEnabled && !isLicensed && isMatlabConnecting) {
                void client.sendNotification(Notification.LicensingServerUrl)
            }
            sendConnectionActionNotification('connect')
        } else if (choice === disconnect) {
            sendConnectionActionNotification('disconnect')
            terminalService.closeTerminal();
        } else if (choice === signOut) {
            void client.sendNotification(Notification.LicensingDelete)
            sendConnectionActionNotification('disconnect')
        }
    })
}

/**
 * Checks if a connection to MATLAB is currently established.
 *
 * This function determines the connection status by checking if the connection status
 * notification text includes a specific label indicating a successful connection.
 *
 * @returns `true` if MATLAB is connected, otherwise `false`.
 */
function isMatlabConnected (): boolean {
    return connectionStatusNotification.text.includes(CONNECTION_STATUS_LABELS.CONNECTED)
}

/**
 * Handles the notifiaction that the connection to MATLAB has changed (either has connected,
 * disconnected, or is in the process of connecting)
 *
 * @param data The notification data
 */
function handleConnectionStatusChange (data: { connectionStatus: string }): void {
    if (data.connectionStatus === 'connected') {
        connectionStatusNotification.text = CONNECTION_STATUS_LABELS.CONNECTED
        const licensingInfo = LicensingUtils.getMinimalLicensingInfo()

        if (LicensingUtils.isSignInSettingEnabled() && licensingInfo !== '') {
            connectionStatusNotification.text += licensingInfo
        }
    } else if (data.connectionStatus === 'disconnected') {
        terminalService.closeTerminal();
        if (isMatlabConnected()) {
            const message = NotificationConstants.MATLAB_CLOSED.message
            const options = NotificationConstants.MATLAB_CLOSED.options
            vscode.window.showWarningMessage(message, ...options
            ).then(choice => {
                if (choice != null) {
                    // Selected to restart MATLAB
                    telemetryLogger.logEvent({
                        eventKey: 'ML_VS_CODE_ACTIONS',
                        data: {
                            action_type: 'restartMATLAB',
                            result: ''
                        }
                    })
                    sendConnectionActionNotification('connect')
                }
            }, reject => console.error(reject))
        }
        connectionStatusNotification.text = CONNECTION_STATUS_LABELS.NOT_CONNECTED
    } else if (data.connectionStatus === 'connecting') {
        connectionStatusNotification.text = CONNECTION_STATUS_LABELS.CONNECTING
    }
}

/**
 * Handles the notification that MATLAB failed to launch successfully. This most likely indicates that
 * either MATLAB is not installed or the installPath setting is not configured correctly.
 */
function handleMatlabLaunchFailed (): void {
    const message = NotificationConstants.MATLAB_LAUNCH_FAILED.message
    const options = NotificationConstants.MATLAB_LAUNCH_FAILED.options
    const url = 'https://www.mathworks.com/products/get-matlab.html'

    terminalService.closeTerminal();

    const configuration = vscode.workspace.getConfiguration('MATLAB')
    const shouldShowPopup = configuration.get<boolean>('showFeatureNotAvailableError') ?? true

    if (shouldShowPopup) {
        vscode.window.showErrorMessage(message, ...options).then(choice => {
            switch (choice) {
                case options[0]: // Get MATLAB
                    void vscode.env.openExternal(vscode.Uri.parse(url))
                    break
                case options[1]: // Open settings
                    void vscode.commands.executeCommand(OPEN_SETTINGS_ACTION, MATLAB_INSTALL_PATH_SETTING)
                    break
                case options[2]: // Do not show again
                    // Selected to not show again
                    void configuration.update('showFeatureNotAvailableError', false, true)
                    break
            }
        }, reject => console.error(reject))
    }
}

/**
 * Handles the notification that a triggered feature is unavailable without MATLAB running
 */
function handleFeatureUnavailable (): void {
    const message = NotificationConstants.FEATURE_UNAVAILABLE.message
    const options = NotificationConstants.FEATURE_UNAVAILABLE.options

    terminalService.closeTerminal();

    const configuration = vscode.workspace.getConfiguration('MATLAB')
    const shouldShowPopup = configuration.get<boolean>('showFeatureNotAvailableError') ?? true

    if (shouldShowPopup) {
        vscode.window.showErrorMessage(
            message,
            ...options
        ).then(choice => {
            switch (choice) {
                case options[0]: // Get MATLAB
                    // Selected to start MATLAB
                    sendConnectionActionNotification('connect')
                    break
                case options[1]: // Do not show again
                    // Selected to not show again
                    void configuration.update('showFeatureNotAvailableError', false, true)
                    break
            }
        }, reject => console.error(reject))
    }
}

/**
 * Handles the notification that a triggered feature is unavailable without MATLAB running,
 * and MATLAB is also unavailable on the system.
 */
function handleFeatureUnavailableWithNoMatlab (): void {
    const message = NotificationConstants.FEATURE_UNAVAILABLE_NO_MATLAB.message
    const options = NotificationConstants.FEATURE_UNAVAILABLE_NO_MATLAB.options
    const url = 'https://www.mathworks.com/products/get-matlab.html'

    terminalService.closeTerminal();

    const configuration = vscode.workspace.getConfiguration('MATLAB')
    const shouldShowPopup = configuration.get<boolean>('showFeatureNotAvailableError') ?? true

    if (shouldShowPopup) {
        vscode.window.showErrorMessage(message, ...options).then(choice => {
            switch (choice) {
                case options[0]: // Get MATLAB
                    void vscode.env.openExternal(vscode.Uri.parse(url))
                    break
                case options[1]: // Open settings
                    void vscode.commands.executeCommand(OPEN_SETTINGS_ACTION, MATLAB_INSTALL_PATH_SETTING)
                    break
                case options[2]: // Do not show again
                    // Selected to not show again
                    void configuration.update('showFeatureNotAvailableError', false, true)
            }
        }, reject => console.error(reject))
    }
}

function handleTelemetryReceived (event: TelemetryEvent): void {
    event.eventKey = `ML_VS_CODE_${event.eventKey}`
    telemetryLogger.logEvent(event)
}

/**
 * Gets the arguments with which to launch the language server
 *
 * @param context The extension context
 * @returns An array of arguments
 */
function getServerArgs (context: vscode.ExtensionContext): string[] {
    const configuration = vscode.workspace.getConfiguration('MATLAB')
    const args = [
        `--matlabInstallPath=${configuration.get<string>('installPath') ?? ''}`,
        `--matlabConnectionTiming=${configuration.get<string>('launchMatlab') ?? 'onStart'}`,
        '--snippetIgnoreList=\'For Loop;If Statement;If-Else Statement;While Loop;Try-Catch Statement;Switch Statement;Function Definition;Class Definition;Parallel For Loop;SPMD block\''
    ]

    if (configuration.get<boolean>('indexWorkspace') ?? false) {
        args.push('--indexWorkspace')
    }

    return args
}

/**
 * Sends notification to language server to instruct it to either connect to or disconnect from MATLAB.
 * @param connectionAction The action - either 'connect' or 'disconnect'
 */
export function sendConnectionActionNotification (connectionAction: 'connect' | 'disconnect'): void {
    void client.sendNotification(Notification.MatlabConnectionClientUpdate, {
        connectionAction
    })
}

// this method is called when your extension is deactivated
export async function deactivate (): Promise<void> {
    await client.stop()
    void client.dispose()
}
