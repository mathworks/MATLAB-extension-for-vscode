// Copyright 2026 The MathWorks, Inc.

// Unit tests for ColumnResizeModel — verifies drag state tracking
// and width computation with minimum-width clamping.

import { expect } from 'chai'
import { ColumnResizeModel } from '../../variableviewer/grid/ColumnResizeModel'

suite('ColumnResizeModel', () => {
    test('isDragging returns false initially', () => {
        // Setup
        const model = new ColumnResizeModel()

        // Exercise
        const result = model.isDragging()

        // Verify
        expect(result).to.be.false
    })

    test('beginDrag sets dragging state', () => {
        // Setup
        const model = new ColumnResizeModel()

        // Exercise
        model.beginDrag(3, 200, 100)
        const result = model.isDragging()

        // Verify
        expect(result).to.be.true
    })

    test('getDrag returns stored state', () => {
        // Setup
        const model = new ColumnResizeModel()
        model.beginDrag(5, 150, 80)

        // Exercise
        const result = model.getDrag()

        // Verify
        expect(result).to.deep.equal({ colIndex: 5, startX: 150, startWidth: 80 })
    })

    test('computeNewWidth returns width based on cursor delta', () => {
        // Setup
        const model = new ColumnResizeModel()
        model.beginDrag(0, 100, 80)

        // Exercise
        const result = model.computeNewWidth(150, 80)

        // Verify
        expect(result).to.equal(130)
    })

    test('computeNewWidth clamps to minimum', () => {
        // Setup
        const model = new ColumnResizeModel()
        model.beginDrag(0, 200, 100)

        // Exercise
        const result = model.computeNewWidth(50, 80)

        // Verify
        expect(result).to.equal(80)
    })

    test('computeNewWidth returns minWidth when no drag active', () => {
        // Setup
        const model = new ColumnResizeModel()

        // Exercise
        const result = model.computeNewWidth(300, 80)

        // Verify
        expect(result).to.equal(80)
    })

    test('endDrag returns colIndex and clears state', () => {
        // Setup
        const model = new ColumnResizeModel()
        model.beginDrag(7, 100, 90)

        // Exercise
        const result = model.endDrag()
        const isDragging = model.isDragging()
        const drag = model.getDrag()

        // Verify
        expect(result).to.equal(7)
        expect(isDragging).to.be.false
        expect(drag).to.be.null
    })

    test('endDrag returns null when no drag active', () => {
        // Setup
        const model = new ColumnResizeModel()

        // Exercise
        const result = model.endDrag()

        // Verify
        expect(result).to.be.null
    })
})
