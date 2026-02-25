// Copyright 2024-2026 The MathWorks, Inc.

import * as vscode from 'vscode'
import { Notifier } from '../commandwindow/Utilities';
import { MVM, MatlabMVMConnectionState } from '../commandwindow/MVM'
import MatlabDebugAdaptor from './MatlabDebugAdaptor';
import TelemetryLogger from '../telemetry/TelemetryLogger';
import BreakpointSynchronizer from './BreakpointSynchronizer';
import TerminalService from '../commandwindow/TerminalService';

export default class MatlabDebugger {
    private readonly _adaptor: MatlabDebugAdaptor;
    private readonly _mvm: MVM;
    private readonly _notifier: Notifier;
    private readonly _telemetryLogger: TelemetryLogger;
    private readonly _terminalService: TerminalService;

    private readonly _breakpointSynchronizer: BreakpointSynchronizer;

    private _activeSession?: vscode.DebugSession;

    private _shouldAutoStart: boolean = false;

    private _hasSentNotification: boolean = false;

    constructor (mvm: MVM, notifier: Notifier, telemetryLogger: TelemetryLogger, terminalService: TerminalService) {
        this._mvm = mvm;
        this._notifier = notifier;
        this._telemetryLogger = telemetryLogger;
        this._terminalService = terminalService;

        this._adaptor = new MatlabDebugAdaptor(mvm, notifier);
        this._breakpointSynchronizer = new BreakpointSynchronizer(mvm, this._adaptor.dispatchRequest.bind(this._adaptor));
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
        vscode.debug.registerDebugConfigurationProvider('matlab', {
            resolveDebugConfiguration (folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
                config.name = 'matlab';
                config.type = 'matlab';
                config.request = 'launch';
                return config;
            }
        } as vscode.DebugConfigurationProvider)

        // eslint-disable-next-line  @typescript-eslint/no-this-alias
        const outerThis = this;
        vscode.debug.registerDebugAdapterDescriptorFactory('matlab', {
            createDebugAdapterDescriptor (_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
                return new vscode.DebugAdapterInlineImplementation(outerThis._adaptor);
            }
        } as vscode.DebugAdapterDescriptorFactory);

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

            void this._terminalService.openTerminalOrBringToFront();
        });

        vscode.debug.onDidTerminateDebugSession(async (session: vscode.DebugSession) => {
            if (this._activeSession === session) {
                this._activeSession = undefined;
            }
        });

        // API not present prior to VS Code version 1.92
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((vscode.debug as any).onDidChangeActiveStackItem !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (vscode.debug as any).onDidChangeActiveStackItem((frame: any) => {
                if (this._activeSession == null || this._activeSession !== frame.session || frame.frameId === undefined) {
                    return;
                }

                // This can be undefined when continuing in the debugger.
                if (frame.frameId !== undefined) {
                    frame.session.customRequest('StackChange', { frame: frame.frameId as number });
                }
            });
        }

        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        this._mvm.on(MVM.Events.stateChanged, this._handleMvmStateChange.bind(this));
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        this._mvm.on(MVM.Events.debuggingStateChanged, this._handleMatlabDebuggingStateChange.bind(this));
    }

    private async _handleMvmStateChange (oldState: MatlabMVMConnectionState, newState: MatlabMVMConnectionState): Promise<void> {
        if (newState === MatlabMVMConnectionState.CONNECTED && oldState === MatlabMVMConnectionState.DISCONNECTED) {
            void vscode.commands.executeCommand('setContext', 'matlab.isDebugging', false);
        } else if (newState === MatlabMVMConnectionState.DISCONNECTED) {
            void vscode.commands.executeCommand('setContext', 'matlab.isDebugging', false);
            this._adaptor.handleDisconnect();
            void vscode.debug.stopDebugging(this._activeSession);
        }
    }

    private async _handleMatlabDebuggingStateChange (isDebugging: boolean): Promise<void> {
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
}
