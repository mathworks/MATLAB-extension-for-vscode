// Copyright 2026 The MathWorks, Inc.

import * as vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node'

import BaseService from '../BaseService'
import { MatlabMVMConnectionState, MVM } from '../../commandwindow/MVM'
import Notification from '../../notifications/Notifications'
import TelemetryLogger from '../telemetry/TelemetryLogger'

interface ProjectInformation {
    name: string
    description: string
    rootFolder: string
}

interface MatlabError {
    msg: string
}

/**
 * Service for handling user interactions with MATLAB projects
 */
export default class MatlabProjectService extends BaseService {
    private readonly projectOpenStatusNotification: vscode.StatusBarItem
    private isProjectOpen = false

    constructor (private readonly client: LanguageClient, private readonly mvm: MVM, private readonly telemetryLogger: TelemetryLogger) {
        super()

        // Initialize isOpen context to false
        void vscode.commands.executeCommand('setContext', 'matlab.project.isOpen', false)

        // Register commands
        this.own(
            vscode.commands.registerCommand('matlab.project.open', this.handleOpenProject.bind(this)),
            vscode.commands.registerCommand('matlab.project.close', this.handleCloseProject.bind(this)),
            vscode.commands.registerCommand('matlab.project.new', this.handleNewProject.bind(this)),
            vscode.commands.registerCommand('matlab.project.actions', this.handleProjectActions.bind(this))
        )

        // Listen for project open/close notifications from the language server
        this.own(
            this.client.onNotification(Notification.ProjectOpened, (projectInfo: ProjectInformation) => {
                this.updateUiOnProjectOpen(projectInfo.name)
            }),
            this.client.onNotification(Notification.ProjectClosed, () => {
                this.updateUiOnProjectClose()
            })
        )

        // Set up MVM connection state listener
        this.own(this.mvm.on(MVM.Events.stateChanged, (oldState: MatlabMVMConnectionState, newState: MatlabMVMConnectionState) => {
            if (oldState === newState) return

            if (newState === MatlabMVMConnectionState.CONNECTED) {
                // Prompt a check for existing open project (e.g. via the user's startup script)
                void this.mvm.feval('matlabls.internal.project.ProjectEventManager.checkForOpenProject', 0, [])
            } else if (newState === MatlabMVMConnectionState.DISCONNECTED) {
                this.updateUiOnProjectClose()
            }
        }))

        this.projectOpenStatusNotification = vscode.window.createStatusBarItem()
        this.projectOpenStatusNotification.command = 'matlab.project.actions'
        this.own(this.projectOpenStatusNotification)
    }

    /**
     * Handles a request to open an existing MATLAB project. The target
     * project to open is specified by the given URI. If no URI is provided,
     * the user will be prompted to select a project definition file via a dialog.
     *
     * @param fileOrFolderUri A URI representing either a MATLAB project definition
     * file (*.prj or matlab.toml), or a folder containing one
     */
    private async handleOpenProject (fileOrFolderUri?: vscode.Uri): Promise<void> {
        if (fileOrFolderUri === undefined) {
            // Open file dialog to select project file
            const selectedFiles = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'MATLAB Projects': ['prj', 'toml']
                },
                title: 'Open MATLAB project'
            })

            if (selectedFiles === undefined || selectedFiles.length === 0) {
                // Workflow aborted
                return
            }

            fileOrFolderUri = selectedFiles[0]
        }

        // Ensure MATLAB is running
        void this.client.sendNotification(Notification.MatlabRequestInstance)
        await this.mvm.getReadyPromise()

        // Show opening indication
        this.updateUiOnProjectOpening()

        // Send command to MALTAB to open the project
        const result = await this.mvm.feval('matlabls.project.openProject', 0, [fileOrFolderUri.fsPath], true)

        if ('error' in result) {
            const error = result.error as MatlabError
            void vscode.window.showErrorMessage(error.msg)
            this.updateUiOnProjectClose()
        } else {
            // No direct action - the UI will be updated via notification from the language server
            this.telemetryLogger.logEvent({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: {
                    action_type: 'projectOpened',
                    result: ''
                }
            })
        }
    }

    /**
     * Handles a request to close the currently active MATLAB project.
     */
    private async handleCloseProject (): Promise<void> {
        if (this.mvm.getMatlabState() === MatlabMVMConnectionState.DISCONNECTED) {
            // Projects can only be open if MATLAB is running, so there is nothing
            // to close if MATLAB is not connected.
            return
        }

        if (!this.isProjectOpen) {
            // No project currently open
            return
        }

        // Send command to MATLAB to close the active project
        const result = this.mvm.feval('matlabls.project.closeProject', 0, [])

        if ('error' in result) {
            const error = result.error as MatlabError
            void vscode.window.showErrorMessage(error.msg)
        } else {
            // No direct action - the UI will be updated via notification from the language server
            this.telemetryLogger.logEvent({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: {
                    action_type: 'projectClosed',
                    result: ''
                }
            })
        }
    }

    /**
     * Handles a request to create a new MATLAB project. The folder in which to
     * create the project is specified by the given URI. If no URI is provided,
     * the user will be prompted to select a folder via a dialog.
     *
     * @param folderUri A folder URI where the new project will be created.
     */
    private async handleNewProject (folderUri?: vscode.Uri): Promise<void> {
        // Prompt the user for a project name
        const projectName = await vscode.window.showInputBox({
            placeHolder: 'Enter project name',
            prompt: 'Create a new MATLAB project'
        })

        if (projectName === undefined || projectName.trim() === '') {
            // Workflow aborted or empty name
            return
        }

        if (folderUri === undefined) {
            // Open file dialog to select the target project folder
            const selectedFolder = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                title: 'Select project folder'
            })

            if (selectedFolder === undefined || selectedFolder.length === 0) {
                // Workflow aborted
                return
            }

            folderUri = selectedFolder[0]
        }

        // Ensure MATLAB is running
        void this.client.sendNotification(Notification.MatlabRequestInstance)
        await this.mvm.getReadyPromise()

        // Send command to MATLAB to create the new project
        const result = await this.mvm.feval('matlabls.project.newProject', 0, [projectName, folderUri.fsPath])

        if ('error' in result) {
            const error = result.error as MatlabError
            void vscode.window.showErrorMessage(error.msg)
        } else {
            // No direct action - the UI will be updated via notification from the language server
            this.telemetryLogger.logEvent({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: {
                    action_type: 'projectCreated',
                    result: ''
                }
            })
        }
    }

    /**
     * Handles a request to perform project-related actions. Displays a quick pick menu
     * with relevant options based on whether a project is currently open.
     */
    private async handleProjectActions (): Promise<void> {
        const placeHolder = 'Select a project action'

        if (this.isProjectOpen) {
            const options = ['Close Project']
            const selectedAction = await vscode.window.showQuickPick(options, { placeHolder })

            if (selectedAction === options[0]) { // Close Project
                await this.handleCloseProject()
            }
        } else {
            const options = ['New Project', 'Open Project']
            const selectedAction = await vscode.window.showQuickPick(options, { placeHolder })

            if (selectedAction === options[0]) { // New Project
                await this.handleNewProject()
            } else if (selectedAction === options[1]) { // Open Project
                await this.handleOpenProject()
            }
        }
    }

    private updateUiOnProjectOpening (): void {
        this.projectOpenStatusNotification.text = 'Opening MATLAB project...'
        this.projectOpenStatusNotification.show()
    }

    private updateUiOnProjectOpen (projectName: string): void {
        this.projectOpenStatusNotification.text = `MATLAB project: ${projectName}`
        this.projectOpenStatusNotification.show()

        void vscode.commands.executeCommand('setContext', 'matlab.project.isOpen', true)
        this.isProjectOpen = true;
    }

    private updateUiOnProjectClose (): void {
        this.projectOpenStatusNotification.text = ''
        this.projectOpenStatusNotification.hide()

        void vscode.commands.executeCommand('setContext', 'matlab.project.isOpen', false)
        this.isProjectOpen = false
    }
}
