// Copyright 2024-2026 The MathWorks, Inc.

import * as vscode from 'vscode'

import CommandWindow from './CommandWindow'
import { Notifier } from './MultiClientNotifier'
import { MVM } from './MVM'
import Notification from '../notifications/Notifications'
import BaseService from '../services/BaseService'
import { ResolvablePromise, createResolvablePromise } from '../utils/ResolvablePromise'

/**
 * Manages the MATLAB VS Code terminal ensuring that only a single one is open at a time
 */
export default class TerminalService extends BaseService {
    private readonly _commandWindow: CommandWindow;

    private readonly _terminalOptions: vscode.ExtensionTerminalOptions;

    private _currentMatlabTerminal?: vscode.Terminal;
    private _terminalCreationPromise?: ResolvablePromise<void>;
    private _timeout: NodeJS.Timeout | undefined;

    constructor (private readonly _client: Notifier, mvm: MVM) {
        super();

        this._commandWindow = new CommandWindow(mvm, _client);

        this._terminalOptions = {
            name: 'MATLAB',
            pty: this._commandWindow,
            isTransient: true
        };

        // Set up listeners
        this.own(
            vscode.window.onDidOpenTerminal(this._handleTerminalOpened.bind(this)),
            vscode.window.onDidCloseTerminal(this._handleTerminalClosed.bind(this)),
            vscode.window.onDidChangeActiveTerminal(this._handleActiveTerminalChanged.bind(this))
        );

        // Register terminal profile provider
        this.own(vscode.window.registerTerminalProfileProvider('matlab.terminal-profile', new MatlabTerminalProvider(this, this._terminalOptions)));

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
            try {
                await this._terminalCreationPromise;
            } finally {
                // No special handling required for rejected promise
                this._terminalCreationPromise = undefined;
            }
        }
    }

    /**
     * Close the current MATLAB terminal
     */
    closeTerminal (): void {
        this._currentMatlabTerminal?.dispose();
        this._currentMatlabTerminal = undefined;

        this._terminalCreationPromise?.reject('Rejecting promise - closing terminal');
        this._terminalCreationPromise = undefined;
    }

    /**
     * @returns The command window
     */
    getCommandWindow (): CommandWindow {
        return this._commandWindow;
    }

    private _handleTerminalOpened (terminal: vscode.Terminal): void {
        if (terminal.creationOptions.name === 'MATLAB') {
            this._currentMatlabTerminal = terminal;
            this._client.sendNotification(Notification.MatlabRequestInstance);
            this._currentMatlabTerminal.show();
            this._timeout = setTimeout(() => {
                if (this._terminalCreationPromise != null) {
                    this._terminalCreationPromise.resolve();
                }
                this._timeout = undefined;
            }, 100);
        }
    }

    private _handleTerminalClosed (terminal: vscode.Terminal): void {
        if (terminal === this._currentMatlabTerminal) {
            this._currentMatlabTerminal = undefined;
        }
    }

    private _handleActiveTerminalChanged (terminal?: vscode.Terminal): void {
        if ((this._currentMatlabTerminal != null) && terminal === this._currentMatlabTerminal) {
            void vscode.commands.executeCommand('setContext', 'matlab.isActiveTerminal', true);
        } else {
            void vscode.commands.executeCommand('setContext', 'matlab.isActiveTerminal', false);
        }
    }

    dispose (): void {
        clearTimeout(this._timeout);
        this._timeout = undefined;

        this._commandWindow.dispose();

        this.closeTerminal();
        super.dispose();
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
