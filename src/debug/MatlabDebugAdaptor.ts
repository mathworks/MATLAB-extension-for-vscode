// Copyright 2024 The MathWorks, Inc.

import * as vscode from 'vscode'
import * as debug from '@vscode/debugadapter'
import { DebugProtocol } from '@vscode/debugprotocol';
import { Notifier } from '../commandwindow/Utilities'
import { MVM, MatlabState } from '../commandwindow/MVM'
import Notification from '../Notifications'

class PackagedRequest {
    debugRequest: DebugProtocol.Request;
    tag: number;

    constructor (request: DebugProtocol.Request, debugAdaptorId: number) {
        this.debugRequest = request;
        this.tag = debugAdaptorId;
    }
}

interface PackagedResponse {
    debugResponse: DebugProtocol.Response
    tag: number
}

interface PackagedEvent {
    debugEvent: DebugProtocol.Event
}

export default class MatlabDebugAdaptor extends debug.DebugSession {
    private readonly _mvm: MVM;
    private readonly _notifier: Notifier;
    private readonly _baseSessionGetter: (dontAutoStart: boolean) => Promise<vscode.DebugSession | null>;

    private readonly _isBase: boolean;

    static _nextId = 1;
    private readonly _debugAdaptorId: number;

    private _isMatlabConnected: boolean = false;
    private _isStarted: boolean = false;

    constructor (mvm: MVM, notifier: Notifier, baseSessionGetter: (dontAutoStart: boolean) => Promise<vscode.DebugSession | null>, isBase: boolean) {
        super()

        this._mvm = mvm;
        this._notifier = notifier;
        this._baseSessionGetter = baseSessionGetter;

        this._debugAdaptorId = MatlabDebugAdaptor._nextId;
        MatlabDebugAdaptor._nextId += 1;

        this._isBase = isBase;

        this._notifier.onNotification(Notification.DebugAdaptorResponse, this._handleResponseNotification.bind(this));
        this._notifier.onNotification(Notification.DebugAdaptorEvent, this._handleEventNotification.bind(this));

        if (this._isBase) {
            this._setupDocumentListeners();
        }
    }

    private _isLifecycleEvent (event: DebugProtocol.Event): boolean {
        return event.event === 'initialized' || event.event === 'exited' || event.event === 'terminate';
    }

    private _handleEventNotification (packagedEvent: PackagedEvent): void {
        const event = packagedEvent.debugEvent;
        if (this._isBase) {
            if (this._isLifecycleEvent(event)) {
                this.sendEvent(event);
            }
        } else {
            if (this._isStarted) {
                this.sendEvent(event);
            }
        }

        if (event.event === 'terminate') {
            this._isStarted = false;
        }
    }

    private _handleResponseNotification (packagedResonse: PackagedResponse): void {
        const response = this._unpackageResponse(packagedResonse);
        if (response !== null) {
            this.sendResponse(response);
        }
    }

    private _packageRequest (request: DebugProtocol.Request): PackagedRequest {
        return new PackagedRequest(request, this._debugAdaptorId);
    }

    private _unpackageResponse (response: PackagedResponse): DebugProtocol.Response | null {
        if (response.tag === this._debugAdaptorId) {
            return response.debugResponse;
        } else {
            return null;
        }
    }

    private _setupDocumentListeners (): void {
        this._mvm.on(MVM.Events.stateChanged, (oldState: MatlabState, newState: MatlabState) => {
            if (oldState === newState) {
                return;
            }

            if (newState === MatlabState.DISCONNECTED) {
                this._isMatlabConnected = false;
            } else {
                if (!this._isMatlabConnected) {
                    vscode.workspace.textDocuments.forEach(this._sendCacheFilePathRequest.bind(this));
                }
                this._isMatlabConnected = true;
            }
        });
        vscode.workspace.onDidOpenTextDocument(this._sendCacheFilePathRequest.bind(this));
    }

    private _sendCacheFilePathRequest (document: vscode.TextDocument): void {
        if (!this._isMatlabConnected) {
            return;
        }

        if (document.fileName.endsWith('.m')) {
            const cacheRequest: DebugProtocol.Request = {
                seq: -1,
                type: 'request',
                command: 'cacheFilePath',
                arguments: { fileName: document.fileName }
            };
            this.dispatchRequest(cacheRequest);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendErrorResponse (response: DebugProtocol.Response, codeOrMessage: number | DebugProtocol.Message, format?: string, variables?: any, dest?: debug.ErrorDestination): void {
        super.sendErrorResponse(response, codeOrMessage, format, variables, dest);
    }

    protected dispatchRequest (request: DebugProtocol.Request): void {
        if (request.command === 'initialize') {
            this._isStarted = true;
        }

        this._notifier.sendNotification(Notification.DebugAdaptorRequest, this._packageRequest(request));
    }

    handleDisconnect (): void {
        this.sendEvent(new debug.ExitedEvent(0));
        this.sendEvent(new debug.TerminatedEvent(false));
    }
}
