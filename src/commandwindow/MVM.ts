// Copyright 2024 The MathWorks, Inc.

import { TextEvent, FEvalResponse, EvalResponse, MVMError, BreakpointResponse, Capability } from './MVMInterface'
import { createResolvablePromise, ResolvablePromise, Notifier } from './Utilities'
import Notification from '../Notifications'
import EventEmitter = require('events')
import { CompletionItem, CompletionList, CompletionParams, DidOpenTextDocumentParams } from 'vscode-languageclient/node'

/**
 * The current state of MATLAB
 */
export enum MatlabState {
    DISCONNECTED = 'disconnected',
    READY = 'ready',
    BUSY = 'busy'
}

interface MatlabStateUpdate {
    state: string
    release: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MatlabData = any;

enum Events {
    clc = 'clc',
    output = 'output',
    promptChange = 'promptChange',
    stateChanged = 'stateChanged',
    debuggingStateChanged = 'debuggingStateChanged'
}

/**
 * A clientside implementation of MATLAB
 */
export class MVM extends EventEmitter {
    static Events = Events;

    private _requestMap: {[requestId: string]: {promise: ResolvablePromise<unknown>, isUserEval: boolean}} = {}
    private _pendingUserEvals: number;

    private readonly _notifier: Notifier;

    private readonly _stateObservers: Array<(oldState: MatlabState, newState: MatlabState) => void> = [];
    private _currentState: MatlabState = MatlabState.DISCONNECTED;
    private _currentRelease: string | null = null;

    private _currentReadyPromise: ResolvablePromise<void>;

    private _isCurrentlyDebugging = false;

    constructor (notifier: Notifier) {
        super();

        this._notifier = notifier;

        this._notifier.onNotification(Notification.MVMEvalComplete, this._handleEvalResponse.bind(this));
        this._notifier.onNotification(Notification.MVMFevalComplete, this._handleFevalResponse.bind(this));
        this._notifier.onNotification(Notification.MVMSetBreakpointComplete, this._handleBreakpointResponse.bind(this));
        this._notifier.onNotification(Notification.MVMClearBreakpointComplete, this._handleBreakpointResponse.bind(this));
        this._notifier.onNotification(Notification.MVMStateChange, this._handleMatlabStateChange.bind(this));
        this._notifier.onNotification(Notification.MVMText, (data: TextEvent) => {
            this.emit(Events.output, data);
        });
        this._notifier.onNotification(Notification.MVMClc, () => {
            this.emit(Events.clc);
        });
        this._notifier.onNotification(Notification.MVMPromptChange, (data) => {
            this.emit(Events.promptChange, data.state, data.isIdle);
        });
        this._notifier.onNotification(Notification.DebuggingStateChange, (isDebugging) => {
            this._isCurrentlyDebugging = isDebugging;
            this.emit(Events.debuggingStateChanged, isDebugging);
        });

        this._currentReadyPromise = createResolvablePromise();

        this._pendingUserEvals = 0;
    }

    sendNotificationDidOpen (params: DidOpenTextDocumentParams): void {
        this._notifier.sendNotificationDidOpen(params);
    }

    sendRequestCompletion (params: CompletionParams): Thenable<CompletionItem[] | CompletionList> {
        return this._notifier.sendRequestCompletion(params);
    }

    /**
     *
     * @returns a promise that is resolved when MATLAB is connected an available
     */
    async getReadyPromise (): Promise<void> {
        return await this._currentReadyPromise;
    }

    /**
     *
     * @returns The current state of MATLAB
     */
    getMatlabState (): MatlabState {
        if (this._currentState === MatlabState.DISCONNECTED) {
            return this._currentState;
        }
        return this._pendingUserEvals > 0 ? MatlabState.BUSY : MatlabState.READY;
    }

    /**
     *
     * @returns The current release of MATLAB
     */
    getMatlabRelease (): string | null {
        return this._currentRelease;
    }

    /**
     *
     * @returns The current release of MATLAB
     */
    isDebugging (): boolean {
        return this.getMatlabState() !== MatlabState.DISCONNECTED && this._isCurrentlyDebugging;
    }

    private _handleMatlabStateChange (newState: MatlabStateUpdate): void {
        const oldState = this._currentState;
        this._currentState = MatlabState[newState.state.toUpperCase() as keyof typeof MatlabState];
        this._currentRelease = newState.release;

        if (this._currentState === MatlabState.DISCONNECTED) {
            this._handleDisconnection();
        }

        this.emit(MVM.Events.stateChanged, oldState, this._currentState);

        if (this._currentState !== MatlabState.DISCONNECTED) {
            this._pendingUserEvals = 0;
            this._currentReadyPromise.resolve();
        }
    }

    private _handleDisconnection (): void {
        const oldPromise = this._currentReadyPromise;
        this._currentReadyPromise = createResolvablePromise();
        oldPromise.reject();

        const requestMap = this._requestMap;
        this._requestMap = {};

        for (const requestIdToCancel in requestMap) {
            requestMap[requestIdToCancel].promise.reject();
        }

        this._pendingUserEvals = 0;
    }

    /**
     * Evaluate the given command.
     * @param command the command to run
     * @param isUserEval Only user evals contribute to the current busy state
     * @returns a promise that is resolved when the eval completes
     */
    eval (command: string, isUserEval: boolean = true, capabilitiesToRemove?: Capability[]): ResolvablePromise<void> {
        const requestId = this._getNewRequestId();
        const promise = createResolvablePromise();
        this._requestMap[requestId] = {
            promise,
            isUserEval
        };

        if (isUserEval) {
            this._pendingUserEvals++;
        }

        this._currentReadyPromise.then(() => {
            this._notifier.sendNotification(Notification.MVMEvalRequest, {
                requestId,
                command,
                isUserEval,
                capabilitiesToRemove
            });
        }, () => {
            // Ignored
        });

        return promise;
    }

    /**
     * Evaluate the given function
     * @param functionName The function to run
     * @param nargout the number of output arguments to request
     * @param args The arguments of the function
     * @returns A promise resolved when the feval completes
     */
    feval<T> (functionName: string, nargout: number, args: unknown[], capabilitiesToRemove?: Capability[]): ResolvablePromise<MVMError | {result: T[]}> {
        const requestId = this._getNewRequestId();
        const promise = createResolvablePromise<MatlabData>();
        this._requestMap[requestId] = {
            promise,
            isUserEval: false
        };

        this._currentReadyPromise.then(() => {
            this._notifier.sendNotification(Notification.MVMFevalRequest, {
                requestId,
                functionName,
                nargout,
                args,
                capabilitiesToRemove
            });
        }, () => {
            // Ignored
        });

        return promise;
    }

    /**
     * Interrupt all pending evaluations
     */
    interrupt (): void {
        this._notifier.sendNotification(Notification.MVMInterruptRequest);
    }

    private _handleEvalResponse (message: EvalResponse): void {
        const obj = this._requestMap[message.requestId];
        if (obj === undefined) {
            return;
        }
        const promise = obj.promise;
        if (this._requestMap[message.requestId].isUserEval) {
            this._pendingUserEvals--;
        }

        promise.resolve();
    }

    private _handleFevalResponse (message: FEvalResponse): void {
        const obj = this._requestMap[message.requestId];
        if (obj === undefined) {
            return;
        }
        const promise = obj.promise;
        if (this._requestMap[message.requestId].isUserEval) {
            this._pendingUserEvals--;
        }

        promise.resolve(message.result);
    }

    private _getNewRequestId (): string {
        return Math.random().toString(36).substr(2, 9);
    }

    setBreakpoint (fileName: string, lineNumber: number, condition?: string, anonymousIndex?: number): ResolvablePromise<void> {
        const requestId = this._getNewRequestId();
        const promise = createResolvablePromise();
        this._requestMap[requestId] = {
            promise,
            isUserEval: false
        };

        this._currentReadyPromise.then(() => {
            this._notifier.sendNotification(Notification.MVMSetBreakpointRequest, {
                requestId,
                fileName,
                lineNumber,
                condition,
                anonymousIndex
            });
        }, () => {
            // Ignored
        });

        return promise;
    }

    clearBreakpoint (fileName: string, lineNumber: number, condition?: string, anonymousIndex?: number): ResolvablePromise<void> {
        const requestId = this._getNewRequestId();
        const promise = createResolvablePromise();
        this._requestMap[requestId] = {
            promise,
            isUserEval: false
        };

        this._currentReadyPromise.then(() => {
            this._notifier.sendNotification(Notification.MVMClearBreakpointRequest, {
                requestId,
                fileName,
                lineNumber,
                condition,
                anonymousIndex
            });
        }, () => {
            // Ignored
        });

        return promise;
    }

    private _handleBreakpointResponse (message: BreakpointResponse): void {
        const obj = this._requestMap[message.requestId];
        if (obj === undefined) {
            return;
        }
        const promise = obj.promise;
        promise.resolve();
    }

    unpause (): void {
        this._currentReadyPromise.then(() => {
            this._notifier.sendNotification(Notification.MVMUnpauseRequest, {});
        }, () => {
            // Ignored
        });
    }
}
