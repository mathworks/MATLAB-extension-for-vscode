// Copyright 2026 The MathWorks, Inc.
import EventEmitter = require('events');

import BaseService from './BaseService';
import { Disposable } from 'vscode';

/**
 * Base class for services which also wish to expose EventEmitter APIs.
 */
export default class EventedService extends BaseService {
    private readonly eventEmitter: EventEmitter = new EventEmitter();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emit (eventName: string, ...args: any[]): boolean {
        return this.eventEmitter.emit(eventName, ...args);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on (event: string, listener: (...args: any[]) => void): Disposable {
        this.eventEmitter.on(event, listener);
        return new Disposable(() => this.eventEmitter.removeListener(event, listener))
    }
}
