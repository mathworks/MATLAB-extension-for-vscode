// Copyright 2024 The MathWorks, Inc.

import * as vscode from 'vscode'
import { Notifier } from '../commandwindow/Utilities';
import { MVM, MatlabState } from '../commandwindow/MVM'
import MatlabDebugAdaptor from './MatlabDebugAdaptor';
import Notification from '../Notifications';
import TelemetryLogger from '../telemetry/TelemetryLogger';

export default class MatlabDebugger {
    private readonly _baseDebugAdaptor: MatlabDebugAdaptor;
    private readonly _nestedDebugAdaptor: MatlabDebugAdaptor;
    private readonly _mvm: MVM;
    private readonly _notifier: Notifier;
    private readonly _telemetryLogger: TelemetryLogger;

    private _isDebugAdaptorStarted: boolean = false;

    private _baseDebugSession: vscode.DebugSession | null = null;
    private readonly _activeSessions: Set<vscode.DebugSession> = new Set();

    private _hasSentNotification: boolean = false;

    constructor (mvm: MVM, notifier: Notifier, telemetryLogger: TelemetryLogger) {
        this._mvm = mvm;
        this._notifier = notifier;
        this._telemetryLogger = telemetryLogger;
        this._baseDebugAdaptor = new MatlabDebugAdaptor(mvm, notifier, this._getBaseDebugSession.bind(this), true)
        this._nestedDebugAdaptor = new MatlabDebugAdaptor(mvm, notifier, this._getBaseDebugSession.bind(this), false)
        this._initialize();

        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (event.affectsConfiguration('MATLAB.startDebuggerAutomatically')) {
                const shouldAutoStart = await vscode.workspace.getConfiguration('MATLAB')?.get<boolean>('startDebuggerAutomatically') ?? true;
                if (shouldAutoStart && this._mvm.getMatlabState() !== MatlabState.DISCONNECTED) {
                    void this._getBaseDebugSession(false);
                } else {
                    if (!this._mvm.isDebugging()) {
                        this._baseDebugAdaptor.handleDisconnect();
                        if (this._baseDebugSession != null) {
                            void vscode.debug.stopDebugging(this._baseDebugSession)
                            this._baseDebugSession = null;
                            this._isDebugAdaptorStarted = false;
                        }
                    }
                }
            }
        });
    }

    private async _getBaseDebugSession (dontAutoStart: boolean): Promise<vscode.DebugSession | null> {
        if (dontAutoStart) {
            return this._baseDebugSession;
        }

        if (this._mvm.getMatlabState() === MatlabState.DISCONNECTED) {
            throw new Error('No base debugging session exists');
        }

        if (this._baseDebugSession != null) {
            return this._baseDebugSession;
        }

        await this._startBaseSession();

        if (this._baseDebugSession === null) {
            throw new Error('No base debugging session exists');
        }

        return this._baseDebugSession;
    }

    private async _startBaseSession (): Promise<void> {
        await vscode.debug.startDebugging(undefined, {
            name: 'base matlab',
            type: 'matlab',
            request: 'launch'
        }, {
            debugUI: { simple: true }
        } as vscode.DebugSessionOptions);
    }

    private _initialize (): void {
        vscode.debug.registerDebugConfigurationProvider('matlab', {
            resolveDebugConfiguration (folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
                config.name = 'matlab';
                config.type = 'matlab';
                config.request = 'launch';
                return config;
            }
        } as vscode.DebugConfigurationProvider)

        const baseDebugAdaptor = this._baseDebugAdaptor;
        const nestedDebugAdaptor = this._nestedDebugAdaptor;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const matlabDebugger = this;
        vscode.debug.registerDebugAdapterDescriptorFactory('matlab', {
            createDebugAdapterDescriptor (_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
                if (matlabDebugger._baseDebugSession == null) {
                    return new vscode.DebugAdapterInlineImplementation(baseDebugAdaptor);
                } else {
                    return new vscode.DebugAdapterInlineImplementation(nestedDebugAdaptor);
                }
            }
        } as vscode.DebugAdapterDescriptorFactory);

        vscode.debug.onDidStartDebugSession(async (session: vscode.DebugSession) => {
            if (session.type !== 'matlab') {
                return;
            }

            this._activeSessions.add(session);
            session.name = 'MATLAB';

            const isInvalidToStartSession = (await vscode.workspace.getConfiguration('MATLAB').get('matlabConnectionTiming')) === 'never'
            if (isInvalidToStartSession) {
                void vscode.debug.stopDebugging(session);
                return;
            }

            this._notifier.sendNotification(Notification.MatlabRequestInstance);
            if (this._baseDebugSession == null) {
                this._baseDebugSession = session;
            } else {
                if (!this._mvm.isDebugging()) {
                    void vscode.debug.stopDebugging(session);
                }
            }
        });

        vscode.debug.onDidTerminateDebugSession(async (session: vscode.DebugSession) => {
            this._activeSessions.delete(session);
            if (session === this._baseDebugSession) {
                this._baseDebugSession = null;
            } else {
                this._isDebugAdaptorStarted = false;
            }
            if (this._mvm.getMatlabState() !== MatlabState.DISCONNECTED) {
                const shouldAutoStart = await vscode.workspace.getConfiguration('MATLAB')?.get<boolean>('startDebuggerAutomatically') ?? true;
                if (shouldAutoStart) {
                    void this._getBaseDebugSession(false);
                }
            }
        });

        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        this._mvm.on(MVM.Events.stateChanged, this._handleMvmStateChange.bind(this));
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        this._mvm.on(MVM.Events.debuggingStateChanged, this._handleMatlabDebuggingStateChange.bind(this));
    }

    private async _handleMvmStateChange (oldState: MatlabState, newState: MatlabState): Promise<void> {
        if (newState === MatlabState.READY && oldState === MatlabState.DISCONNECTED) {
            void vscode.commands.executeCommand('setContext', 'matlab.isDebugging', false);
            const shouldAutoStart = await vscode.workspace.getConfiguration('MATLAB')?.get<boolean>('startDebuggerAutomatically') ?? true;
            if (shouldAutoStart) {
                void this._getBaseDebugSession(false);
            }
        } else if (newState === MatlabState.DISCONNECTED) {
            void vscode.commands.executeCommand('setContext', 'matlab.isDebugging', false);
            this._baseDebugAdaptor.handleDisconnect();
            this._activeSessions.forEach((session) => {
                void vscode.debug.stopDebugging(session);
            })
            this._isDebugAdaptorStarted = false;
        }
    }

    private async _handleMatlabDebuggingStateChange (isDebugging: boolean): Promise<void> {
        void vscode.commands.executeCommand('setContext', 'matlab.isDebugging', isDebugging);

        if (!isDebugging) {
            return;
        }

        const shouldReact = await this._shouldReactToDebugEvent();
        const isStillDebugging = this._mvm.isDebugging();

        if (shouldReact && isStillDebugging) {
            void this._maybeStartDebugger();
        }
    }

    private async _maybeStartDebugger (): Promise<void> {
        if (this._isDebugAdaptorStarted) {
            return;
        }

        if (!this._hasSentNotification) {
            this._hasSentNotification = true;
            this._telemetryLogger.logEvent({
                eventKey: 'ML_VS_CODE_ACTIONS',
                data: {
                    action_type: 'debuggerStarted',
                    result: ''
                }
            });
        }

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const baseSession = this._baseDebugSession ?? undefined;

        const wasDebuggerStartSuccessful = await vscode.debug.startDebugging(undefined, {
            name: 'matlab',
            type: 'matlab',
            request: 'launch'
        }, {
            parentSession: baseSession,
            compact: true,
            suppressDebugStatusbar: false,
            suppressDebugToolbar: false,
            suppressDebugView: false
        });

        this._isDebugAdaptorStarted = wasDebuggerStartSuccessful;
    }

    private async _shouldReactToDebugEvent (): Promise<boolean> {
        const shouldAutoStart = await vscode.workspace.getConfiguration('MATLAB')?.get<boolean>('startDebuggerAutomatically') ?? true;
        if (!shouldAutoStart) {
            const baseSession = await this._getBaseDebugSession(true);
            if (baseSession === null) {
                return false;
            }
        }
        return true;
    }
}
