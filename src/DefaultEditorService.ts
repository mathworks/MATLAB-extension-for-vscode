// Copyright 2025 The MathWorks, Inc.

import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import * as path from 'path'
import * as vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node';
import { MatlabState, MVM } from './commandwindow/MVM'
import Notification from './Notifications'

export default class DefaultEditorService {
    private initialized = false;

    constructor (private readonly context: vscode.ExtensionContext, private readonly client: LanguageClient, private readonly mvm: MVM) {
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(() => {
                void this.handleConfigChanged()
            })
        )

        mvm.on(MVM.Events.stateChanged, (oldState: MatlabState, newState: MatlabState) => {
            if (oldState === newState) {
                return;
            }

            if (newState === MatlabState.READY || newState === MatlabState.BUSY) {
                if (!this.initialized) {
                    this.initialized = true
                    void this.handleConfigChanged()
                }
            } else {
                this.initialized = false
            }
        });
    }

    /** Helper function: checks if a specific path from array of path strings exists and returns true if a path string is found in file system else returns false
     * @param paths array of string paths to be checked in file system
     * @returns path string if it exists in file system else null
    */
    private checkPath (paths: string[]): string | null {
        for (const p of paths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
        return null;
    }

    private getFallbackExecutablePaths (): string[] {
        const appRoot = vscode.env.appRoot;
        const platform = process.platform;
        const fallbackPaths: string[] = [];

        if (platform === 'win32') {
            // appRoot: C:\Program Files\Microsoft VS Code\resources\app
            // Executable: C:\Program Files\Microsoft VS Code\Code.exe
            fallbackPaths.push(
                path.join(path.dirname(path.dirname(appRoot)), 'Code.exe')
            );
        } else if (platform === 'darwin') {
            // appRoot: /Applications/Visual Studio Code.app/Contents/Resources/app
            // Executable: /Applications/Visual Studio Code.app/Contents/MacOS/Electron
            // or /Applications/Visual Studio Code.app/Contents/MacOS/Visual Studio Code
            // Try both
            const appDir = path.dirname(path.dirname(appRoot)); // .../Visual Studio Code.app/Contents
            fallbackPaths.push(
                path.join(appDir, 'MacOS', 'Visual Studio Code'),
                path.join(appDir, 'MacOS', 'Electron')
            );
        } else {
            // Linux
            // appRoot: /usr/share/code/resources/app
            // Executable: /usr/share/code/code
            fallbackPaths.push(
                path.join(path.dirname(path.dirname(appRoot)), 'code')
            );
        }
        return fallbackPaths
    }

    /** Look into most probable installation paths based on OS to find VS Code executable path
     * @returns path string found for VS Code executable
    */
    public getVSCodePath (): Promise<string> {
        return new Promise((resolve, reject) => {
            const fallbackPaths = this.getFallbackExecutablePaths()

            const platform = os.platform();

            const command = platform === 'win32' ? 'where code' : 'which code';

            exec(command, (error, stdout, stderr) => {
                if ((error == null) && typeof stdout === 'string' && stdout !== '') {
                    resolve(stdout.trim().split('\n').filter(Boolean)[0].trim());
                } else {
                    const fallback = this.checkPath(fallbackPaths);
                    if (typeof fallback === 'string' && fallback.length > 0) {
                        resolve(fallback);
                    } else {
                        reject(new Error('MATLAB Default Editor: Error getting VS Code executable path'));
                    }
                }
            });
        });
    }

    /**
     * Handles the notification that MATLAB failed to set VS Code as default editor successfully. This most likely indicates that
     * either VS Code is not installed in a default location and 'code' is not added to PATH.
     * @param matlabConfig VsCode Workspace object for MATLAB extension configuration
     */
    public async handleVsCodePathError (matlabConfig: vscode.WorkspaceConfiguration): Promise<void> {
        const message = 'Unable to set MATLAB default editor to Visual Studio Code. Check that VS Code is installed in a default location or add it to the system PATH.'
        const availableCmds = await vscode.commands.getCommands()
        const options = ['Add VS Code to PATH']

        if (availableCmds.includes('workbench.action.installCommandLine')) {
            vscode.window.showErrorMessage(message, ...options).then(choice => {
                switch (choice) {
                    case options[0]:
                        void vscode.commands.executeCommand('workbench.action.installCommandLine')
                        break
                }
            }, reject => console.error(reject))
        } else {
            vscode.window.showErrorMessage(message).then(choice => { /* empty */ }, reject => console.error(reject))
        }
        void matlabConfig.update('defaultEditor', false, true);
    }

    /**
     * Handles config state management. Finds VS Code executable path when defaultEditor config is enabled and displays an error message if path not found.
     */
    public handleConfigChanged (): void {
        const configuration = vscode.workspace.getConfiguration('MATLAB')
        if ((configuration.get<boolean>('defaultEditor') ?? true)) {
            this.getVSCodePath().then(validPath => {
                void this.sendExecutablePathNotification(validPath)
            }).catch(err => {
                console.error(err)
                void this.handleVsCodePathError(configuration)
            });
        }
    }

    /**
    * Sends notification to language server to update default editor to VS Code.
    * @param executablePath The path to VS Code
    */
    public sendExecutablePathNotification (executablePath: string): void {
        void this.client.sendNotification(Notification.EditorExecutablePath, executablePath)
    }
}
