// Copyright 2024-2025 The MathWorks, Inc.

import * as vscode from 'vscode'

/**
 * A promise with resolve and reject methods. Allows easier storing of the promise to be resolved elsewhere.
 */
export interface ResolvablePromise<T> extends Promise<T> {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    resolve: any
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    reject: any
}

/**
 * Creates a resolvable promise
 * @returns A resolvable promise
 */
export function createResolvablePromise<T = void> (): ResolvablePromise<T> {
    let res, rej;
    const p = new Promise<T>((resolve, reject) => {
        res = resolve;
        rej = reject;
    }) as ResolvablePromise<T>;
    p.resolve = res;
    p.reject = rej;
    return p;
}

/**
 * Represents an object that can send and recieve data on specific channels.
 */
export interface Notifier {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendNotification: (tag: string, data?: any) => void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onNotification: (tag: string, callback: (data: any) => void) => vscode.Disposable
}

export class MultiClientNotifier implements Notifier {
    readonly _notifier: Notifier;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _callbacks: { [tag: string]: Array<(data: any) => void> } = {};

    constructor (notifier: Notifier) {
        this._notifier = notifier;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendNotification (tag: string, data?: any): void {
        this._notifier.sendNotification(tag, data);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onNotification (tag: string, callback: (data: any) => void): vscode.Disposable {
        if (!(tag in this._callbacks)) {
            this._callbacks[tag] = [];
            this._notifier.onNotification(tag, this._handler.bind(this, tag));
        }
        const callbacks = this._callbacks[tag];
        callbacks.push(callback);
        return new vscode.Disposable(() => {
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1); // Removes 1 element at the index
            }
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _handler (tag: string, data: any): void {
        this._callbacks[tag].forEach((callback) => {
            callback(data);
        }, this);
    }
}

export class Disposer extends vscode.Disposable {
    private _owned: vscode.Disposable[] = [];

    constructor () {
        super(() => {
            this._owned.forEach((obj) => obj.dispose());
            this._owned = [];
        });
    }

    own (disposable: vscode.Disposable): void {
        this._owned.push(disposable);
    }
}
