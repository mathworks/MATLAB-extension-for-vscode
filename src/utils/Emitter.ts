// Copyright 2026 The MathWorks, Inc.

import { Disposable } from './Disposable';

/**
 * Registers a listener for an event. Dispose the returned disposable to unregister it.
 */
export type Event<T> = (listener: (data: T) => void) => Disposable

/**
 * Fires an event to the listeners registered through its event function.
 */
export class Emitter<T> implements Disposable {
    private readonly _listeners: Array<(data: T) => void> = []

    readonly event: Event<T> = (listener) => {
        this._listeners.push(listener);

        return new Disposable(() => {
            const index = this._listeners.indexOf(listener);
            if (index > -1) {
                this._listeners.splice(index, 1);
            }
        });
    }

    fire (data: T): void {
        // Iterate over a copy, so that a listener that unregisters does not skip the next one
        [...this._listeners].forEach(listener => listener(data));
    }

    dispose (): void {
        this._listeners.length = 0;
    }
}
