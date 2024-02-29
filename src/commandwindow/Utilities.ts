// Copyright 2024 The MathWorks, Inc.

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
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    sendNotification: (tag: string, data?: any) => void
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    onNotification: (tag: string, callback: (data: any) => void) => void
}
