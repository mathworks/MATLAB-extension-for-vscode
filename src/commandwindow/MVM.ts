// Copyright 2024 The MathWorks, Inc.

import IMVM, { TextEvent, FEvalResponse, EvalResponse, FEvalError } from './MVMInterface'
import { createResolvablePromise, ResolvablePromise, Notifier } from './Utilities'
import Notification from '../Notifications'

/**
 * The current state of MATLAB
 */
export enum MatlabState {
    DISCONNECTED = 'disconnected',
    READY = 'ready',
    BUSY = 'busy'
}

/**
 * A clientside implementation of MATLAB
 */
export default class MVMImpl implements IMVM {
    private _requestMap: {[requestId: string]: {promise: ResolvablePromise<unknown>, isUserEval: boolean}} = {}
    private _pendingUserEvals: number;

    private readonly _notifier: Notifier;

    private readonly _stateObservers: Array<(oldState: MatlabState, newState: MatlabState) => void> = [];
    private _currentState: MatlabState = MatlabState.DISCONNECTED;

    private _currentReadyPromise: ResolvablePromise<void>;

    constructor (notifier: Notifier) {
        this._notifier = notifier;

        this._notifier.onNotification(Notification.MVMEvalComplete, this._handleEvalResponse.bind(this));
        this._notifier.onNotification(Notification.MVMFevalComplete, this._handleFevalResponse.bind(this));
        this._notifier.onNotification(Notification.MVMStateChange, this._handleMatlabStateChange.bind(this));
        this._notifier.onNotification(Notification.MVMText, (data: TextEvent) => {
            this.onOutput(data)
        });
        this._notifier.onNotification(Notification.MVMClc, () => { this.onClc() });

        this._currentReadyPromise = createResolvablePromise();

        this._pendingUserEvals = 0;
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

    private _handleMatlabStateChange (newState: string): void {
        const oldState = this._currentState;
        this._currentState = MatlabState[newState.toUpperCase() as keyof typeof MatlabState];

        if (this._currentState === MatlabState.DISCONNECTED) {
            this._handleDisconnection();
        }

        this._stateObservers.forEach((observer) => {
            observer(oldState, this._currentState);
        }, this);

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
     * Allow listening to MATLAB state changes
     * @param observer
     */
    addStateChangeListener (observer: (oldState: MatlabState, newState: MatlabState) => void): void {
        this._stateObservers.push(observer);
    }

    /**
     * Evaluate the given command.
     * @param command the command to run
     * @param isUserEval Only user evals contribute to the current busy state
     * @returns a promise that is resolved when the eval completes
     */
    eval (command: string): ResolvablePromise<void>;
    eval (command: string, isUserEval: boolean = true): ResolvablePromise<void> {
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
                command
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
    feval<T> (functionName: string, nargout: number, args: unknown[]): ResolvablePromise<FEvalError | T> {
        const requestId = this._getNewRequestId();
        const promise = createResolvablePromise<T>();
        this._requestMap[requestId] = {
            promise,
            isUserEval: false
        };

        this._currentReadyPromise.then(() => {
            this._notifier.sendNotification(Notification.MVMFevalRequest, {
                requestId,
                functionName,
                nargout,
                args
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

    /**
     * Called with output from any requests
     * @param data
     */
    onOutput (data: TextEvent): void {
        throw new Error('Method not overridden.');
    }

    /**
     * Called when a clc is run
     */
    onClc (): void {
        throw new Error('Method not overridden.');
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
}
