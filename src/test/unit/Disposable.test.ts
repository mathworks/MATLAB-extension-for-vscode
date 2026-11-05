// Copyright 2026 The MathWorks, Inc.

import * as assert from 'assert';
import { suite, test } from 'mocha';
import { Disposable } from '../../utils/Disposable';

suite('Disposable', () => {
    test('calls the function the first time it is disposed', () => {
        let calls = 0;
        const disposable = new Disposable(() => { calls++; });
        disposable.dispose();
        disposable.dispose();
        assert.strictEqual(calls, 1);
    });
});
