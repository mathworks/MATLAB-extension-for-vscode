// Copyright 2026 The MathWorks, Inc.

/**
 * A resource that can be released. Calls the given function the first time it is disposed.
 */
export class Disposable {
    // Optional, so that any object with a dispose() method still fits where a Disposable is expected
    private _callOnDispose?: () => void

    constructor (callOnDispose: () => void) {
        this._callOnDispose = callOnDispose;
    }

    dispose (): void {
        if (this._callOnDispose !== undefined) {
            this._callOnDispose();
            this._callOnDispose = undefined;
        }
    }
}
