// Copyright 2024-2026 The MathWorks, Inc.

import * as vscode from 'vscode'

import BreakpointSynchronizer from './BreakpointSynchronizer';
import MatlabDebugAdaptor from './MatlabDebugAdaptor';
import { Notifier } from '../commandwindow/MultiClientNotifier';
import { MVM, MatlabMVMConnectionState } from '../commandwindow/MVM';
import TerminalService from '../commandwindow/TerminalService';
import BaseService from '../services/BaseService';
import TelemetryLogger from '../services/telemetry/TelemetryLogger';

export default class MatlabDebugger extends BaseService {
    private readonly _adaptor: MatlabDebugAdaptor;

    private readonly _breakpointSynchronizer: BreakpointSynchronizer;

    private _activeSession?: vscode.DebugSession;

    private _shouldAutoStart: boolean = false;

    private _hasSentNotification: boolean = false;

    constructor (private readonly _mvm: MVM, notifier: Notifier, private readonly _telemetryLogger: TelemetryLogger, private readonly _terminalService: TerminalService) {
        super();

        this._adaptor = new MatlabDebugAdaptor(_mvm, notifier);
        this._breakpointSynchronizer = new BreakpointSynchronizer(_mvm, this._adaptor.dispatchRequest.bind(this._adaptor));
        this._initialize();

        this._shouldAutoStart = vscode.workspace.getConfiguration('MATLAB')?.get<boolean>('startDebuggerAutomatically') ?? false;
        if (this._shouldAutoStart) {
            this._breakpointSynchronizer.enable();
        } else {
            this._breakpointSynchronizer.disable();
        }

        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (event.affectsConfiguration('MATLAB.startDebuggerAutomatically')) {
                this._shouldAutoStart = vscode.workspace.getConfiguration('MATLAB')?.get<boolean>('startDebuggerAutomatically') ?? false;
                if (this._shouldAutoStart) {
                    this._breakpointSynchronizer.enable();
                    void this._maybeStartDebugger();
                } else {
                    this._breakpointSynchronizer.disable();
                }
            }
        });
    }

    private _initialize (): void {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const outerThis = this;

        this.own(
            vscode.debug.registerDebugConfigurationProvider('matlab', {
                resolveDebugConfiguration (folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
                    config.name = 'matlab';
                    config.type = 'matlab';
                    config.request = 'launch';
                    return config;
                }
            } as vscode.DebugConfigurationProvider),

            vscode.debug.registerDebugAdapterDescriptorFactory('matlab', {
                createDebugAdapterDescriptor (_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
                    return new vscode.DebugAdapterInlineImplementation(outerThis._adaptor);
                }
            } as vscode.DebugAdapterDescriptorFactory),

            vscode.debug.onDidStartDebugSession(async (session: vscode.DebugSession) => {
                if (session.type !== 'matlab') {
                    return;
                }

                if (this._activeSession != null) {
                    void vscode.debug.stopDebugging(session);
                }

                session.name = 'MATLAB';

                const isInvalidToStartSession = vscode.workspace.getConfiguration('MATLAB').get('matlabConnectionTiming') === 'never'
                if (isInvalidToStartSession && this._mvm.getMatlabState() === MatlabMVMConnectionState.DISCONNECTED) {
                    void vscode.debug.stopDebugging(session);
                    return;
                }

                this._activeSession = session;
                void this._terminalService.openTerminalOrBringToFront();
            }),

            vscode.debug.onDidTerminateDebugSession(async (session: vscode.DebugSession) => {
                if (this._activeSession === session) {
                    this._activeSession = undefined;
                }
            })
        );

        // API not present prior to VS Code version 1.92
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((vscode.debug as any).onDidChangeActiveStackItem !== undefined) {
            this.own(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (vscode.debug as any).onDidChangeActiveStackItem((frame: any) => {
                    if (this._activeSession == null || this._activeSession !== frame.session || frame.frameId === undefined) {
                        return;
                    }

                    // This can be undefined when continuing in the debugger.
                    if (frame.frameId !== undefined) {
                        frame.session.customRequest('StackChange', { frame: frame.frameId as number });
                    }
                })
            );
        }

        this.own(
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            this._mvm.on(MVM.Events.stateChanged, this._handleMvmStateChange.bind(this)),
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            this._mvm.on(MVM.Events.debuggingStateChanged, this._handleMatlabDebuggingStateChange.bind(this))
        );
    }

    private _handleMvmStateChange (oldState: MatlabMVMConnectionState, newState: MatlabMVMConnectionState): void {
        if (newState === MatlabMVMConnectionState.CONNECTED && oldState === MatlabMVMConnectionState.DISCONNECTED) {
            void vscode.commands.executeCommand('setContext', 'matlab.isDebugging', false);
        } else if (newState === MatlabMVMConnectionState.DISCONNECTED) {
            void vscode.commands.executeCommand('setContext', 'matlab.isDebugging', false);
            this._adaptor.handleDisconnect();
            void vscode.debug.stopDebugging(this._activeSession);
        }
    }

    private _handleMatlabDebuggingStateChange (isDebugging: boolean): void {
        void vscode.commands.executeCommand('setContext', 'matlab.isDebugging', isDebugging);

        if (!isDebugging) {
            return;
        }

        void this._maybeStartDebugger();
    }

    private async _maybeStartDebugger (): Promise<void> {
        if (!this._shouldAutoStart || !this._mvm.isDebugging()) {
            return;
        }

        if (this._activeSession !== undefined) {
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

        const debuggerConfiguration = {
            parentSession: undefined,
            compact: true,
            suppressDebugStatusbar: false,
            suppressDebugToolbar: false,
            suppressDebugView: false
        } as vscode.DebugSessionOptions;

        await vscode.debug.startDebugging(undefined, {
            name: 'matlab',
            type: 'matlab',
            request: 'launch'
        }, debuggerConfiguration);
    }

    dispose (): void {
        this._adaptor.dispose_temp();
        this._breakpointSynchronizer.dispose();

        super.dispose()
    }
}
