// Copyright 2026 The MathWorks, Inc.

// Tests for selectRenderer: verifies the support classification logic
// that determines whether a variable renders in the grid or the preview pane.

import { expect } from 'chai'
import { selectRenderer } from '../../variableviewer/validation'

suite('isVariableSupported (via selectRenderer)', () => {
    // Verifies that a standard 2-D numeric array is supported
    test('supported numeric class, 2-D, not sparse, not tall returns grid', () => {
        expect(selectRenderer({ dataType: 'double', size: [5, 5], isSparse: false, isTall: false })).to.equal('grid')
        expect(selectRenderer({ dataType: 'single', size: [1, 10], isSparse: false, isTall: false })).to.equal('grid')
        expect(selectRenderer({ dataType: 'int8', size: [3, 3], isSparse: false, isTall: false })).to.equal('grid')
        expect(selectRenderer({ dataType: 'uint64', size: [1, 1], isSparse: false, isTall: false })).to.equal('grid')
    })

    // Verifies that non-numeric, non-tabular classes are unsupported regardless of other flags
    test('unsupported class returns unsupported', () => {
        expect(selectRenderer({ dataType: 'struct', size: [1, 1], isSparse: false, isTall: false })).to.equal('unsupported')
        expect(selectRenderer({ dataType: 'cell', size: [3, 3], isSparse: false, isTall: false })).to.equal('unsupported')
        expect(selectRenderer({ dataType: 'string', size: [1, 5], isSparse: false, isTall: false })).to.equal('unsupported')
        expect(selectRenderer({ dataType: 'timetable', size: [10, 3], isSparse: false, isTall: false })).to.equal('unsupported')
    })

    // Verifies that table class routes to grid renderer
    test('table class returns grid', () => {
        expect(selectRenderer({ dataType: 'table', size: [10, 3], isSparse: false, isTall: false })).to.equal('grid')
        expect(selectRenderer({ dataType: 'table', size: [1, 1], isSparse: false, isTall: false })).to.equal('grid')
    })

    // Verifies that tall tables are unsupported
    test('tall table returns unsupported', () => {
        expect(selectRenderer({ dataType: 'table', size: [Infinity, 3], isSparse: false, isTall: true })).to.equal('unsupported')
    })

    // Verifies that sparse numeric arrays are unsupported
    test('sparse numeric array returns unsupported', () => {
        expect(selectRenderer({ dataType: 'double', size: [100, 100], isSparse: true, isTall: false })).to.equal('unsupported')
        expect(selectRenderer({ dataType: 'single', size: [50, 50], isSparse: true, isTall: false })).to.equal('unsupported')
    })

    // Verifies that tall arrays are unsupported
    test('tall array returns unsupported', () => {
        expect(selectRenderer({ dataType: 'double', size: [Infinity, 3], isSparse: false, isTall: true })).to.equal('unsupported')
        expect(selectRenderer({ dataType: 'int32', size: [Infinity, 1], isSparse: false, isTall: true })).to.equal('unsupported')
    })

    // Verifies that N-dimensional arrays (3+ dimensions) are unsupported
    test('N-dimensional array returns unsupported', () => {
        expect(selectRenderer({ dataType: 'double', size: [3, 4, 5], isSparse: false, isTall: false })).to.equal('unsupported')
        expect(selectRenderer({ dataType: 'uint8', size: [2, 3, 4, 5], isSparse: false, isTall: false })).to.equal('unsupported')
    })

    // Verifies that scalars and vectors are supported
    test('scalar and vector sizes are supported', () => {
        expect(selectRenderer({ dataType: 'double', size: [1, 1], isSparse: false, isTall: false })).to.equal('grid')
        expect(selectRenderer({ dataType: 'double', size: [1, 10], isSparse: false, isTall: false })).to.equal('grid')
        expect(selectRenderer({ dataType: 'double', size: [10, 1], isSparse: false, isTall: false })).to.equal('grid')
    })

    // Verifies that combined unsupported flags still return unsupported
    test('sparse and tall simultaneously returns unsupported', () => {
        expect(selectRenderer({ dataType: 'double', size: [Infinity, 3], isSparse: true, isTall: true })).to.equal('unsupported')
    })
})
