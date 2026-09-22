// Copyright 2026 The MathWorks, Inc.

// Tests for the validation module: verifies selectRenderer maps variable
// metadata to the correct renderer type.

import { expect } from 'chai'
import { selectRenderer } from '../../variableviewer/validation'
import { VariableMetadata } from '../../variableviewer/types'

function meta (dataType: string, size: readonly number[], isSparse: boolean = false, isTall: boolean = false): VariableMetadata {
    return { dataType, size, isSparse, isTall }
}

suite('selectRenderer', () => {
    // Verifies that standard 2-D numeric classes route to the grid renderer
    test('2-D numeric types select grid renderer', () => {
        const numericClasses = ['double', 'single', 'int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64']
        for (const cls of numericClasses) {
            expect(selectRenderer(meta(cls, [5, 5]))).to.equal('grid', `expected grid for ${cls}`)
        }
    })

    // Verifies that non-numeric, non-tabular classes route to the unsupported renderer
    test('non-numeric types select unsupported renderer', () => {
        const unsupportedClasses = ['struct', 'cell', 'string', 'timetable', 'categorical', 'containers.Map']
        for (const cls of unsupportedClasses) {
            expect(selectRenderer(meta(cls, [1, 1]))).to.equal('unsupported', `expected unsupported for ${cls}`)
        }
    })

    // Verifies that table class routes to the grid renderer
    test('table type selects grid renderer', () => {
        expect(selectRenderer(meta('table', [10, 3]))).to.equal('grid')
        expect(selectRenderer(meta('table', [1, 1]))).to.equal('grid')
        expect(selectRenderer(meta('table', [100, 20]))).to.equal('grid')
    })

    // Verifies that tall tables route to unsupported
    test('tall table selects unsupported renderer', () => {
        expect(selectRenderer(meta('table', [Infinity, 3], false, true))).to.equal('unsupported')
    })

    // Verifies that sparse arrays route to the unsupported renderer
    test('sparse numeric array selects unsupported renderer', () => {
        expect(selectRenderer(meta('double', [100, 100], true, false))).to.equal('unsupported')
    })

    // Verifies that tall arrays route to the unsupported renderer
    test('tall array selects unsupported renderer', () => {
        expect(selectRenderer(meta('double', [Infinity, 3], false, true))).to.equal('unsupported')
    })

    // Verifies that N-dimensional arrays route to the unsupported renderer
    test('N-dimensional array selects unsupported renderer', () => {
        expect(selectRenderer(meta('double', [3, 4, 5], false, false))).to.equal('unsupported')
    })

    // Verifies that scalars and vectors select the grid renderer
    test('scalar and vector shapes select grid renderer', () => {
        expect(selectRenderer(meta('double', [1, 1]))).to.equal('grid')
        expect(selectRenderer(meta('int32', [1, 10]))).to.equal('grid')
        expect(selectRenderer(meta('uint8', [10, 1]))).to.equal('grid')
    })
})
