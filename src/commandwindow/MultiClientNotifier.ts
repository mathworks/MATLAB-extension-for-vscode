// Copyright 2026 The MathWorks, Inc.
import { Disposable } from 'vscode';

import BaseService from '../services/BaseService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CallbackFcn = (data: any) => void;

/**
 * Represents an object that can send and recieve data on specific channels.
 */
export interface Notifier {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendNotification: (tag: string, data?: any) => void
    onNotification: (tag: string, callback: CallbackFcn) => Disposable
}

export default class MultiClientNotifier extends BaseService {
    readonly _notifier: Notifier;

    _callbacks: { [tag: string]: CallbackFcn[] } = {};

    constructor (notifier: Notifier) {
        super();
        this._notifier = notifier;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendNotification (tag: string, data?: any): void {
        this._notifier.sendNotification(tag, data);
    }

    onNotification (tag: string, callback: CallbackFcn): Disposable {
        if (!(tag in this._callbacks)) {
            this._callbacks[tag] = [];
            this.own(this._notifier.onNotification(tag, this._handler.bind(this, tag)));
        }

        const callbacks = this._callbacks[tag];
        callbacks.push(callback);

        return new Disposable(() => {
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _handler (tag: string, data: any): void {
        this._callbacks[tag].forEach((callback) => {
            callback(data);
        }, this);
    }
}
