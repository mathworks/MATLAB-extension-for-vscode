// Copyright 2024 The MathWorks, Inc.

import * as vscode from 'vscode'
import { MVM } from './MVM'
import { Notifier, ResolvablePromise, createResolvablePromise } from './Utilities'
import CommandWindow from './CommandWindow'
import Notification from '../Notifications'

/**
 * Manages the MATLAB VS Code terminal ensuring that only a single one is open at a time
 */
export default class TerminalService {
    private readonly _mvm: MVM;
    private readonly _client: Notifier;
    private readonly _commandWindow: CommandWindow;

    private readonly _terminalOptions: vscode.ExtensionTerminalOptions;

    private _currentMatlabTerminal?: vscode.Terminal;
    private _terminalCreationPromise?: ResolvablePromise<void>;

    constructor (client: Notifier, mvm: MVM) {
        this._mvm = mvm;
        this._client = client;

        this._commandWindow = new CommandWindow(mvm);

        this._terminalOptions = {
            name: 'MATLAB',
            pty: this._commandWindow,
            isTransient: true
        };

        vscode.window.onDidOpenTerminal((terminal) => {
            if (terminal.creationOptions.name === 'MATLAB') {
                this._currentMatlabTerminal = terminal;
                client.sendNotification(Notification.MatlabRequestInstance);
                this._currentMatlabTerminal.show();
                setTimeout(() => {
                    if (this._terminalCreationPromise != null) {
                        this._terminalCreationPromise.resolve();
                    }
                }, 100);
            }
        });

        vscode.window.onDidCloseTerminal((terminal) => {
            if (terminal === this._currentMatlabTerminal) {
                this._currentMatlabTerminal = undefined;
            }
        });

        vscode.window.registerTerminalProfileProvider('matlab.terminal-profile', new MatlabTerminalProvider(this, this._terminalOptions));

        vscode.window.onDidChangeActiveTerminal(terminal => {
            if ((this._currentMatlabTerminal != null) && terminal === this._currentMatlabTerminal) {
                void vscode.commands.executeCommand('setContext', 'matlab.isActiveTerminal', true);
            } else {
                void vscode.commands.executeCommand('setContext', 'matlab.isActiveTerminal', false);
            }
        })

        // Required to ensure that Ctrl+C keybinding is handled by vscode and not the terminal itself
        const terminalConfiguration = vscode.workspace.getConfiguration('terminal.integrated');
        const commandsToNotSendToTerminal: string[] | undefined = terminalConfiguration.get<string[]>('commandsToSkipShell');
        if ((commandsToNotSendToTerminal != null) && !commandsToNotSendToTerminal.includes('matlab.interrupt')) {
            commandsToNotSendToTerminal.push('matlab.interrupt');
            void terminalConfiguration.update('commandsToSkipShell', commandsToNotSendToTerminal, true);
        }
    }

    /**
     * Opens or brings the MATLAB termianl to the front.
     * @returns resolves when the terminal is visible
     */
    async openTerminalOrBringToFront (): Promise<void> {
        this._client.sendNotification(Notification.MatlabRequestInstance);
        if (this._currentMatlabTerminal != null) {
            this._currentMatlabTerminal.show();
        } else {
            vscode.window.createTerminal(this._terminalOptions);
            this._terminalCreationPromise = createResolvablePromise();
            await this._terminalCreationPromise;
        }
    }

    /**
     * Close the current MATLAB terminal
     */
    closeTerminal (): void {
        if (this._currentMatlabTerminal != null) {
            this._currentMatlabTerminal.dispose();
        }
    }

    /**
     * @returns The command window
     */
    getCommandWindow (): CommandWindow {
        return this._commandWindow;
    }
}

/**
 * Provides a VS Code terminal window backed by the command window.
 */
class MatlabTerminalProvider {
    private readonly _terminalService: TerminalService;
    private readonly _terminalOptions: vscode.ExtensionTerminalOptions;

    constructor (terminalService: TerminalService, terminalOptions: vscode.ExtensionTerminalOptions) {
        this._terminalService = terminalService;
        this._terminalOptions = terminalOptions;
    }

    provideTerminalProfile (token: vscode.CancellationToken): vscode.ProviderResult<vscode.TerminalProfile> {
        this._terminalService.closeTerminal();
        return new vscode.TerminalProfile(this._terminalOptions);
    }
}
