// Copyright 2026 The MathWorks, Inc.

import * as assert from 'assert';
import { suite, test } from 'mocha';
import { Emitter } from '../../utils/Emitter';

suite('Emitter', () => {
    test('fires to each registered listener until it is unregistered', () => {
        const emitter = new Emitter<string>();
        const first: string[] = [];
        const second: string[] = [];
        const registration = emitter.event(data => first.push(data));
        emitter.event(data => second.push(data));

        emitter.fire('a');
        registration.dispose();
        emitter.fire('b');

        assert.deepStrictEqual(first, ['a']);
        assert.deepStrictEqual(second, ['a', 'b']);
    });

    test('still fires to the next listener when a listener unregisters itself', () => {
        const emitter = new Emitter<string>();
        const received: string[] = [];
        const registration = emitter.event(() => registration.dispose());
        emitter.event(data => received.push(data));

        emitter.fire('a');

        assert.deepStrictEqual(received, ['a']);
    });

    test('fires to no listeners after it is disposed', () => {
        const emitter = new Emitter<string>();
        const received: string[] = [];
        emitter.event(data => received.push(data));

        emitter.dispose();
        emitter.fire('a');

        assert.deepStrictEqual(received, []);
    });
});
