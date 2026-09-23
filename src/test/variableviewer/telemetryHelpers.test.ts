// Copyright 2026 The MathWorks, Inc.

// Tests for telemetry helper functions: verifies elementId mapping covers
// all variable types and that nameHash produces deterministic hex output.

import { expect } from 'chai'
import { getElementId, hashVariableName, formatDimensions } from '../../variableviewer/telemetryHelpers'

suite('getElementId', () => {
    // Verifies that grid numeric classes map to numeric_table
    test('grid + numeric classes return numeric_table', () => {
        // Setup
        const numericClasses = ['double', 'single', 'int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64', 'logical']

        // Exercise & Verify
        for (const cls of numericClasses) {
            const result = getElementId(cls, 'grid', [5, 5])
            expect(result).to.equal('numeric_table', `expected numeric_table for ${cls}`)
        }
    })

    // Verifies that grid table class maps to table_table
    test('grid + table returns table_table', () => {
        // Exercise
        const result = getElementId('table', 'grid', [10, 3])

        // Verify
        expect(result).to.equal('table_table')
    })

    // Verifies that unsupported char maps to char_disp
    test('unsupported + char returns char_disp', () => {
        // Exercise
        const result = getElementId('char', 'unsupported', [1, 10])

        // Verify
        expect(result).to.equal('char_disp')
    })

    // Verifies that unsupported string maps to string_disp
    test('unsupported + string returns string_disp', () => {
        // Exercise
        const result = getElementId('string', 'unsupported', [3, 1])

        // Verify
        expect(result).to.equal('string_disp')
    })

    // Verifies that unsupported cell maps to cell_disp
    test('unsupported + cell returns cell_disp', () => {
        // Exercise
        const result = getElementId('cell', 'unsupported', [2, 3])

        // Verify
        expect(result).to.equal('cell_disp')
    })

    // Verifies that unsupported datetime maps to datetime_disp
    test('unsupported + datetime returns datetime_disp', () => {
        // Exercise
        const result = getElementId('datetime', 'unsupported', [5, 1])

        // Verify
        expect(result).to.equal('datetime_disp')
    })

    // Verifies that unsupported duration maps to duration_disp
    test('unsupported + duration returns duration_disp', () => {
        // Exercise
        const result = getElementId('duration', 'unsupported', [5, 1])

        // Verify
        expect(result).to.equal('duration_disp')
    })

    // Verifies that unsupported categorical maps to categorical_disp
    test('unsupported + categorical returns categorical_disp', () => {
        // Exercise
        const result = getElementId('categorical', 'unsupported', [5, 1])

        // Verify
        expect(result).to.equal('categorical_disp')
    })

    // Verifies that unsupported timetable maps to timetable_disp
    test('unsupported + timetable returns timetable_disp', () => {
        // Exercise
        const result = getElementId('timetable', 'unsupported', [10, 3])

        // Verify
        expect(result).to.equal('timetable_disp')
    })

    // Verifies that scalar struct maps to struct_disp
    test('unsupported + struct 1x1 returns struct_disp', () => {
        // Exercise
        const result = getElementId('struct', 'unsupported', [1, 1])

        // Verify
        expect(result).to.equal('struct_disp')
    })

    // Verifies that non-scalar struct maps to struct_disp
    test('unsupported + struct array returns struct_disp', () => {
        // Exercise
        const result = getElementId('struct', 'unsupported', [3, 4])

        // Verify
        expect(result).to.equal('struct_disp')
    })

    // Verifies that N-D struct maps to struct_disp
    test('unsupported + N-D struct returns struct_disp', () => {
        // Exercise
        const result = getElementId('struct', 'unsupported', [1, 1, 1])

        // Verify
        expect(result).to.equal('struct_disp')
    })

    // Verifies that sparse/tall/N-D table still maps to table_disp
    test('unsupported + table returns table_disp', () => {
        // Exercise
        const result = getElementId('table', 'unsupported', [Infinity, 3])

        // Verify
        expect(result).to.equal('table_disp')
    })

    // Verifies that sparse numeric (unsupported renderer) maps to object_disp
    test('unsupported + known numeric returns object_disp', () => {
        // Exercise
        const result = getElementId('double', 'unsupported', [100, 100])

        // Verify
        expect(result).to.equal('object_disp')
    })

    // Verifies that a scalar unknown type maps to object_disp
    test('unsupported + unknown scalar type returns object_disp', () => {
        // Exercise
        const result = getElementId('mypackage.MyClass', 'unsupported', [1, 1])

        // Verify
        expect(result).to.equal('object_disp')
    })

    // Verifies that an array of unknown type maps to objectarray_disp
    test('unsupported + unknown array type returns objectarray_disp', () => {
        // Exercise
        const result = getElementId('mypackage.MyClass', 'unsupported', [3, 1])

        // Verify
        expect(result).to.equal('objectarray_disp')
    })

    // Verifies that a truly unknown 0x0 type falls back to object_disp
    test('unsupported + unknown empty type returns object_disp', () => {
        // Exercise
        const result = getElementId('mypackage.MyClass', 'unsupported', [0, 0])

        // Verify
        expect(result).to.equal('object_disp')
    })
})

suite('hashVariableName', () => {
    // Verifies that the same input always produces the same output
    test('produces deterministic output', () => {
        // Exercise
        const hash1 = hashVariableName('myVar')
        const hash2 = hashVariableName('myVar')

        // Verify
        expect(hash1).to.equal(hash2)
    })

    // Verifies that different inputs produce different outputs
    test('produces different output for different inputs', () => {
        // Exercise
        const hashX = hashVariableName('x')
        const hashY = hashVariableName('y')

        // Verify
        expect(hashX).to.not.equal(hashY)
    })

    // Verifies that the output is a valid hex string
    test('returns a hex string', () => {
        // Exercise
        const result = hashVariableName('testVar')

        // Verify
        expect(result).to.match(/^[0-9a-f]+$/)
    })

    // Verifies that empty string produces a valid result
    test('handles empty string', () => {
        // Exercise
        const result = hashVariableName('')

        // Verify
        expect(result).to.match(/^[0-9a-f]+$/)
    })

    // Verifies that unicode variable names produce a valid result
    test('handles unicode variable names', () => {
        // Exercise
        const result = hashVariableName('αβγ')

        // Verify
        expect(result).to.match(/^[0-9a-f]+$/)
    })
})

suite('formatDimensions', () => {
    // Verifies that 2-D size produces bracket format
    test('formats 2-D size as [rows,cols]', () => {
        // Exercise
        const result = formatDimensions([3, 4])

        // Verify
        expect(result).to.equal('[3,4]')
    })

    // Verifies that N-D size produces bracket format
    test('formats N-D size', () => {
        // Exercise
        const result = formatDimensions([2, 3, 4])

        // Verify
        expect(result).to.equal('[2,3,4]')
    })

    // Verifies that scalar produces bracket format
    test('formats scalar size', () => {
        // Exercise
        const result = formatDimensions([1, 1])

        // Verify
        expect(result).to.equal('[1,1]')
    })
})
