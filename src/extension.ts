// Copyright 2022-2026 The MathWorks, Inc.

import * as path from 'path'

import * as vscode from 'vscode'
import {
    LanguageClient, LanguageClientOptions, ServerOptions, TransportKind
} from 'vscode-languageclient/node'

import ExecutionCommandProvider from './commandwindow/ExecutionCommandProvider'
import MultiClientNotifier from './commandwindow/MultiClientNotifier'
import { MVM } from './commandwindow/MVM'
import TerminalService from './commandwindow/TerminalService'
import MatlabDebugger from './debug/MatlabDebugger'
import NotificationConstants from './notifications/NotificationConstants'
import Notification from './notifications/Notifications'
import DefaultEditorService from './services/defaultEditor/DefaultEditorService'
import DeprecationPopupService from './services/deprecation/DeprecationPopupService'
import { SectionModel } from './services/sections/model/SectionModel'
import SectionStylingService from './services/sections/view/SectionStylingService'
import TelemetryLogger, { TelemetryEvent } from './services/telemetry/TelemetryLogger'
import * as LicensingUtils from './utils/LicensingUtils'
import BaseService from './services/BaseService'
import WorkspaceBrowserProvider from './workspacebrowser/WorkspaceBrowserProvider'
import MatlabProjectService from './services/projects/MatlabProjectService'

const CONNECTION_STATUS_COMMAND = 'matlab.changeMatlabConnection'
const OPEN_SETTINGS_COMMAND = 'workbench.action.openSettings'
const MATLAB_INSTALL_PATH_SETTING = 'MATLAB.installPath'
export const CONNECTION_STATUS_LABELS = {
    CONNECTED: 'MATLAB: Connected',
    NOT_CONNECTED: 'MATLAB: Not Connected',
    CONNECTING: 'MATLAB: Establishing Connection'
}

export let extension: MatlabExtension | null = null

export async function activate (context: vscode.ExtensionContext): Promise<void> {
    extension = new MatlabExtension(context)
    await extension.start()
}

export async function deactivate (): Promise<void> {
    await extension?.dispose()
    extension = null
}

/**
 * Class defining the logic for the MATLAB extension for VS Code
 */
class MatlabExtension extends BaseService {
    private readonly client: LanguageClient

    private readonly telemetryLogger: TelemetryLogger
    private readonly sectionModel: SectionModel
    private readonly mvm: MVM
    private readonly matlabDebugger: MatlabDebugger
    private readonly terminalService: TerminalService
    private readonly executionCommandProvider: ExecutionCommandProvider

    private readonly connectionStatusNotification: vscode.StatusBarItem

    constructor (context: vscode.ExtensionContext) {
        super()

        this.client = this.setupLanguageServer(context)

        // =============== Initialize Services =============== //

        // Initialize Telemetry Logger
        this.telemetryLogger = new TelemetryLogger(context.extension.packageJSON.version)
        this.telemetryLogger.logEvent({
            eventKey: 'ML_VS_CODE_ENVIRONMENT',
            data: {
                machine_hash: vscode.env.machineId,
                locale: vscode.env.language,
                os_platform: process.platform,
                vs_code_version: vscode.version
            }
        })

        // Initialize MVM, Terminal, and Debugger
        const multiclientNotifier = new MultiClientNotifier(this.client)
        this.mvm = new MVM(multiclientNotifier)
        this.terminalService = new TerminalService(multiclientNotifier, this.mvm)
        this.executionCommandProvider = new ExecutionCommandProvider(this.mvm, this.terminalService, this.telemetryLogger)
        this.matlabDebugger = new MatlabDebugger(this.mvm, multiclientNotifier, this.telemetryLogger, this.terminalService)

        // Initialize Deprecation Popup Service
        const deprecationPopupService = new DeprecationPopupService(context, this.client)

        // Initialize Default Editor Service
        const defaultEditorService = new DefaultEditorService(this.client, this.mvm)

        // Initialize Section Model & Styling
        this.sectionModel = new SectionModel(this.client)
        const sectionStylingService = new SectionStylingService(this.sectionModel)

        // Initialize MATLAB Project Service
        const matlabProjectService = new MatlabProjectService(this.client, this.mvm, this.telemetryLogger)

        // Add all disposable services to context subscriptions
        this.own(
            this.telemetryLogger,
            multiclientNotifier,
            this.mvm,
            this.terminalService,
            this.executionCommandProvider,
            this.matlabDebugger,
            deprecationPopupService,
            defaultEditorService,
            this.sectionModel,
            sectionStylingService,
            matlabProjectService
        )

        // =============== Setup UI Affordances =============== //

        // Set up MATLAB connection status bar indicator
        this.connectionStatusNotification = vscode.window.createStatusBarItem()
        this.connectionStatusNotification.text = CONNECTION_STATUS_LABELS.NOT_CONNECTED
        this.connectionStatusNotification.command = CONNECTION_STATUS_COMMAND
        this.connectionStatusNotification.show()

        this.own(this.connectionStatusNotification)

        // =============== Setup VS Code Commands =============== //
        this.own(
            vscode.commands.registerCommand(CONNECTION_STATUS_COMMAND, () => this.handleChangeMatlabConnection()),

            vscode.commands.registerCommand('matlab.runFile', async () => await this.executionCommandProvider.handleRunFile()),
            vscode.commands.registerCommand('matlab.runSection', async () => await this.executionCommandProvider.handleRunSection(this.sectionModel)),
            vscode.commands.registerCommand('matlab.runSelection', async () => await this.executionCommandProvider.handleRunSelection()),
            vscode.commands.registerCommand('matlab.interrupt', () => this.executionCommandProvider.handleInterrupt()),
            vscode.commands.registerCommand('matlab.openCommandWindow', async () => await this.terminalService.openTerminalOrBringToFront()),
            vscode.commands.registerCommand('matlab.addFolderToPath', async (uri: vscode.Uri) => await this.executionCommandProvider.handleAddFolderToPath(uri)),
            vscode.commands.registerCommand('matlab.addFolderAndSubfoldersToPath', async (uri: vscode.Uri) => await this.executionCommandProvider.handleAddFolderAndSubfoldersToPath(uri)),
            vscode.commands.registerCommand('matlab.changeDirectory', async (uri: vscode.Uri) => await this.executionCommandProvider.handleChangeDirectory(uri)),
            vscode.commands.registerCommand('matlab.openFile', async (uri: vscode.Uri) => await this.executionCommandProvider.handleOpenFile(uri)),
            vscode.commands.registerCommand('matlab.showLanguageServerOutput', () => this.client.outputChannel.show())
        )

        // =============== Setup Licensing & Sign-on =============== //

        // Register a custom command which allows the user enable / disable Sign In options.
        // Using this custom command would be an alternative approach to going to enabling the setting.
        this.own(vscode.commands.registerCommand('matlab.enableSignIn', async () => await handleEnableSignIn()))

        // Setup listeners only if licensing workflows are enabled.
        // Any further changes to the configuration settings will be handled by configChangeListener.
        if (LicensingUtils.isSignInSettingEnabled()) {
            LicensingUtils.setupLicensingListeners(this.client)
        }

        // =============== Setup Additional Handlers =============== //

        // Set up event listener to react to changes in VS Code's configuration
        this.own(vscode.workspace.onDidChangeConfiguration(() => this.handleConfigurationChanged))

        // Initialize workspace browser — the provider handles lifecycle internally via MVM events
        const workspaceBrowserProvider = new WorkspaceBrowserProvider(context, multiclientNotifier, this.mvm, this.telemetryLogger)
        this.own(
            vscode.window.registerWebviewViewProvider('workspaceBrowserSidebarView', workspaceBrowserProvider),
            workspaceBrowserProvider
        )
    }

    /**
     * Starts the langauge client
     */
    async start (): Promise<void> {
        await this.client.start()
    }

    getConnectionStatusBarItem (): vscode.StatusBarItem {
        return this.connectionStatusNotification
    }

    /**
     * Sends notification to language server to instruct it to either connect to or disconnect from MATLAB.
     * @param connectionAction The action - either 'connect' or 'disconnect'
     */
    sendConnectionActionNotification (connectionAction: 'connect' | 'disconnect'): void {
        void this.client.sendNotification(Notification.MatlabConnectionClientUpdate, {
            connectionAction
        })
    }

    /**
     * Sets up the connection to the MATLAB language server.
     * Does not start the language client.
     *
     * @param serverModule The path to the language server module
     * @returns The language client
     */
    private setupLanguageServer (context: vscode.ExtensionContext): LanguageClient {
        const serverModule: string = context.asAbsolutePath(path.join('server', 'out', 'index.js'))

        const args = getServerArgs()

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
                    execArgv: ['--nolazy', '--inspect=6009', '--trace-warnings']
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
        const client = new LanguageClient(
            'matlabls',
            'MATLAB Language Server',
            serverOptions,
            clientOptions
        )

        // Set up notification listeners
        this.own(
            client.onNotification(Notification.MatlabConnectionServerUpdate, (data: { connectionStatus: string }) => this.handleConnectionStatusChange(data)),
            client.onNotification(Notification.MatlabLaunchFailed, () => this.handleMatlabLaunchFailed()),
            client.onNotification(Notification.MatlabFeatureUnavailable, () => this.handleFeatureUnavailable()),
            client.onNotification(Notification.MatlabFeatureUnavailableNoMatlab, () => this.handleFeatureUnavailableWithNoMatlab()),
            client.onNotification(Notification.LogTelemetryData, (data: TelemetryEvent) => this.handleTelemetryReceived(data))
        )

        return client
    }

    /**
     * Handles user input about whether to connect or disconnect from MATLAB®
     */
    private handleChangeMatlabConnection (): void {
        const connect = 'Connect to MATLAB'
        const disconnect = 'Disconnect from MATLAB'
        const options = [connect, disconnect]

        const isSignInEnabled = LicensingUtils.isSignInSettingEnabled()
        const signOut = 'Sign Out of MATLAB'
        const isLicensed = LicensingUtils.getMinimalLicensingInfo() !== ''
        const isMatlabConnecting = this.connectionStatusNotification.text === CONNECTION_STATUS_LABELS.CONNECTING

        // Only show signout option when signin setting is enabled, MATLAB is connected and is licensed
        if (isSignInEnabled && isLicensed && this.isMatlabConnected()) {
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
                    void this.client.sendNotification(Notification.LicensingServerUrl)
                }
                this.sendConnectionActionNotification('connect')
            } else if (choice === disconnect) {
                this.sendConnectionActionNotification('disconnect')
                this.terminalService.closeTerminal()
            } else if (choice === signOut) {
                void this.client.sendNotification(Notification.LicensingDelete)
                this.sendConnectionActionNotification('disconnect')
            }
        })
    }

    /**
     * Event handler called when the VS Code configuration is changed by the user
     */
    private handleConfigurationChanged (): void {
        const configuration = vscode.workspace.getConfiguration('MATLAB')

        // Updates the licensing status bar item and listeners based on the `signIn` setting.
        if (configuration.get<boolean>(LicensingUtils.LICENSING_SETTING_NAME) ?? false) {
            LicensingUtils.setupLicensingListeners(this.client)
        } else {
            LicensingUtils.removeLicensingListeners()
        }
    }

    /**
     * Checks if a connection to MATLAB is currently established.
     *
     * This function determines the connection status by checking if the connection status
     * notification text includes a specific label indicating a successful connection.
     *
     * @returns `true` if MATLAB is connected, otherwise `false`.
     */
    private isMatlabConnected (): boolean {
        return this.connectionStatusNotification.text.includes(CONNECTION_STATUS_LABELS.CONNECTED)
    }

    /**
     * Handles the notifiaction that the connection to MATLAB has changed (either has connected,
     * disconnected, or is in the process of connecting)
     *
     * @param data The notification data
     */
    private handleConnectionStatusChange (data: { connectionStatus: string }): void {
        if (data.connectionStatus === 'connected') {
            this.connectionStatusNotification.text = CONNECTION_STATUS_LABELS.CONNECTED
            const licensingInfo = LicensingUtils.getMinimalLicensingInfo()

            if (LicensingUtils.isSignInSettingEnabled() && licensingInfo !== '') {
                this.connectionStatusNotification.text += licensingInfo
            }
        } else if (data.connectionStatus === 'disconnected') {
            this.terminalService.closeTerminal()
            if (this.isMatlabConnected()) {
                const message = NotificationConstants.MATLAB_CLOSED.message
                const options = NotificationConstants.MATLAB_CLOSED.options
                vscode.window.showWarningMessage(message, ...options
                ).then(choice => {
                    if (choice != null) {
                        // Selected to restart MATLAB
                        this.telemetryLogger.logEvent({
                            eventKey: 'ML_VS_CODE_ACTIONS',
                            data: {
                                action_type: 'restartMATLAB',
                                result: ''
                            }
                        })
                        this.sendConnectionActionNotification('connect')
                    }
                }, reject => console.error(reject))
            }
            this.connectionStatusNotification.text = CONNECTION_STATUS_LABELS.NOT_CONNECTED
        } else if (data.connectionStatus === 'connecting') {
            this.connectionStatusNotification.text = CONNECTION_STATUS_LABELS.CONNECTING
        }
    }

    /**
     * Handles the notification that MATLAB failed to launch successfully. This most likely indicates that
     * either MATLAB is not installed or the installPath setting is not configured correctly.
     */
    private handleMatlabLaunchFailed (): void {
        const message = NotificationConstants.MATLAB_LAUNCH_FAILED.message
        const options = NotificationConstants.MATLAB_LAUNCH_FAILED.options
        const url = 'https://www.mathworks.com/products/get-matlab.html'

        this.terminalService.closeTerminal()

        const configuration = vscode.workspace.getConfiguration('MATLAB')
        const shouldShowPopup = configuration.get<boolean>('showFeatureNotAvailableError') ?? true

        if (shouldShowPopup) {
            vscode.window.showErrorMessage(message, ...options).then(choice => {
                switch (choice) {
                    case options[0]: // Get MATLAB
                        void vscode.env.openExternal(vscode.Uri.parse(url))
                        break
                    case options[1]: // Open settings
                        void vscode.commands.executeCommand(OPEN_SETTINGS_COMMAND, MATLAB_INSTALL_PATH_SETTING)
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
    private handleFeatureUnavailable (): void {
        const message = NotificationConstants.FEATURE_UNAVAILABLE.message
        const options = NotificationConstants.FEATURE_UNAVAILABLE.options

        this.terminalService.closeTerminal()

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
                        this.sendConnectionActionNotification('connect')
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
    private handleFeatureUnavailableWithNoMatlab (): void {
        const message = NotificationConstants.FEATURE_UNAVAILABLE_NO_MATLAB.message
        const options = NotificationConstants.FEATURE_UNAVAILABLE_NO_MATLAB.options
        const url = 'https://www.mathworks.com/products/get-matlab.html'

        this.terminalService.closeTerminal()

        const configuration = vscode.workspace.getConfiguration('MATLAB')
        const shouldShowPopup = configuration.get<boolean>('showFeatureNotAvailableError') ?? true

        if (shouldShowPopup) {
            vscode.window.showErrorMessage(message, ...options).then(choice => {
                switch (choice) {
                    case options[0]: // Get MATLAB
                        void vscode.env.openExternal(vscode.Uri.parse(url))
                        break
                    case options[1]: // Open settings
                        void vscode.commands.executeCommand(OPEN_SETTINGS_COMMAND, MATLAB_INSTALL_PATH_SETTING)
                        break
                    case options[2]: // Do not show again
                        // Selected to not show again
                        void configuration.update('showFeatureNotAvailableError', false, true)
                }
            }, reject => console.error(reject))
        }
    }

    private handleTelemetryReceived (event: TelemetryEvent): void {
        event.eventKey = `ML_VS_CODE_${event.eventKey}`
        this.telemetryLogger.logEvent(event)
    }

    async dispose (): Promise<void> {
        await this.client.stop()
        super.dispose()
    }
}

/**
 * Gets the arguments with which to launch the language server
 *
 * @param context The extension context
 * @returns An array of arguments
 */
function getServerArgs (): string[] {
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
    const configuration = vscode.workspace.getConfiguration('MATLAB')
    const enable = 'Enable'
    const disable = 'Disable'

    const choices = LicensingUtils.isSignInSettingEnabled() ? [disable] : [enable]

    const choice = await vscode.window.showQuickPick(choices, {
        placeHolder: 'Manage Sign In Options'
    })

    if (choice == null) {
        return
    }

    if (choice === 'Enable') {
        await configuration.update(LicensingUtils.LICENSING_SETTING_NAME, true, vscode.ConfigurationTarget.Global)
        void vscode.window.showInformationMessage('Sign In Options enabled.')
    } else if (choice === 'Disable') {
        await configuration.update(LicensingUtils.LICENSING_SETTING_NAME, false, vscode.ConfigurationTarget.Global)
        void vscode.window.showInformationMessage('Sign In Options disabled.')
    }
}
