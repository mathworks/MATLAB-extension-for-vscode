// Copyright 2026 The MathWorks, Inc.
import { Disposable } from 'vscode';

export default class BaseService extends Disposable {
    private _owned: Disposable[] = []

    constructor () {
        super(() => {
            // Clean up owned disposables when the owning service is disposed
            this._owned.forEach(disposable => disposable.dispose());
            this._owned = [];
        })
    }

    /**
     * Own the cleanup of the provided disposable. When this service is disposed,
     * all owned disposables will be disposed as well.
     *
     * @param disposable The disposable to clean up at service disposal.
     */
    own (...disposables: Disposable[]): void {
        disposables.forEach(disposable => this._owned.push(disposable))
    }
}
