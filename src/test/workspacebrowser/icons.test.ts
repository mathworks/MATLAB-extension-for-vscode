// Copyright 2026 The MathWorks, Inc.

// Tests for the icon mapping module that resolves MATLAB class names to SVG filenames.
// Verifies direct lookups, numeric type fallback, substring-based fallback, and the
// default icon for unknown types.

import { expect } from 'chai'
import { getIconFilename } from '../../workspacebrowser/icons'

suite('getIconFilename', () => {
    // ── Direct lookup: each mapped type returns its specific icon ──
    // These tests act as a regression guard against accidental changes to the
    // icon mapping table. If a mapping is removed or renamed, the corresponding
    // test will fail and flag the mismatch before it reaches users.

    suite('known types return their mapped icon', () => {
        const knownTypes: Array<[string, string]> = [
            ['object', 'ws3d.svg'],
            ['cell', 'wsBrackets.svg'],
            ['calendarduration', 'wsCalendar.svg'],
            ['char', 'wsCharacter.svg'],
            ['logical', 'wsCheck.svg'],
            ['duration', 'wsClock.svg'],
            ['datetime', 'wsDate.svg'],
            ['default', 'wsDefault.svg'],
            ['categorical', 'wsDots.svg'],
            ['ordinal', 'wsDots.svg'],
            ['nominal', 'wsDots.svg'],
            ['sparse', 'wsSparse.svg'],
            ['string', 'wsString.svg'],
            ['table', 'wsTable.svg'],
            ['dataset', 'wsTable.svg'],
            ['timetable', 'wsTableTime.svg'],
            ['eventtable', 'wsTableTime.svg'],
            ['tall', 'wsTall.svg'],
            ['timeseries', 'wsTime.svg'],
            ['struct', 'wsTree.svg']
        ]

        for (const [matlabClass, expectedIcon] of knownTypes) {
            test(`'${matlabClass}' -> '${expectedIcon}'`, () => {
                expect(getIconFilename(matlabClass)).to.equal(expectedIcon)
            })
        }
    })

    // ── Numeric type fallback: all MATLAB numeric primitives share the default icon ──
    // MATLAB has 10 numeric primitive types (double, single, int8..uint64) that are
    // not individually listed in the icon map. They must all resolve to wsDefault.svg
    // via the NUMERIC_TYPES set. If a new numeric type is added to MATLAB in the
    // future and not handled, this suite will need to be updated.

    suite('numeric types fall back to wsDefault.svg', () => {
        const numericTypes = [
            'double', 'single',
            'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64'
        ]

        for (const numType of numericTypes) {
            test(`'${numType}' -> 'wsDefault.svg'`, () => {
                expect(getIconFilename(numType)).to.equal('wsDefault.svg')
            })
        }
    })

    // ── Substring-based fallback: types containing 'sparse' or 'tall' ──
    // MATLAB compound types like 'double sparse' or 'tall double' include the
    // qualifier as a substring. These don't match any direct key in the icon map,
    // so the fallback logic checks for substring containment. This is important
    // because the server reports these as compound class strings, not separate
    // tokens, and without this fallback they would incorrectly get the object icon.

    suite('substring fallback for compound types', () => {
        test("type containing 'sparse' returns wsSparse.svg", () => {
            expect(getIconFilename('double sparse')).to.equal('wsSparse.svg')
        })

        test("type containing 'tall' returns wsTall.svg", () => {
            expect(getIconFilename('tall double')).to.equal('wsTall.svg')
        })
    })

    // ── Unknown types fall back to the generic object icon ──
    // Users can define custom MATLAB classes that won't match any known type or
    // substring pattern. These must gracefully fall back to the generic object
    // icon (ws3d.svg) rather than causing a render error or showing no icon.

    suite('unknown types', () => {
        test('completely unknown class returns ws3d.svg (object icon)', () => {
            expect(getIconFilename('somecustomclass')).to.equal('ws3d.svg')
        })

        test('empty string returns ws3d.svg', () => {
            expect(getIconFilename('')).to.equal('ws3d.svg')
        })
    })
})
