// Copyright 2026 The MathWorks, Inc.

// Verifies that ViewStateManager correctly saves, restores, validates,
// debounces, and clears grid view state across webview hide/show cycles.

import { expect } from 'chai'
import * as sinon from 'sinon'
import { ColumnLayout } from '../../variableviewer/grid/ColumnLayout'
import { SelectionModel } from '../../variableviewer/grid/SelectionModel'
import { ViewStateManager } from '../../variableviewer/grid/ViewStateManager'
import { VariableMetadata, GridViewState } from '../../variableviewer/types'

// ── Helpers ──────────────────────────────────────────────────────

interface MockApi {
    postMessage: sinon.SinonStub
    getState: sinon.SinonStub
    setState: sinon.SinonStub
}

function createMockApi (): MockApi {
    return {
        postMessage: sinon.stub(),
        getState: sinon.stub().returns(null),
        setState: sinon.stub()
    }
}

function createScrollContainer (scrollTop: number, scrollLeft: number): HTMLElement {
    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true, writable: true })
    Object.defineProperty(el, 'scrollLeft', { value: scrollLeft, configurable: true, writable: true })
    return el
}

function createMetadata (dataType: string, rows: number, cols: number): VariableMetadata {
    return { dataType, size: [rows, cols], isSparse: false, isTall: false }
}

function createLayout (numCols: number): ColumnLayout {
    const layout = new ColumnLayout()
    layout.computeWidths(numCols)
    return layout
}

function createSavedState (matlabClass: string, selection: { row: number, col: number } | null): GridViewState {
    return {
        matlabClass,
        viewport: { scroll: { scrollTop: 240, scrollLeft: 800 }, selection },
        columnWidths: [{ index: 5, width: 150 }]
    }
}

// ── Tests ────────────────────────────────────────────────────────

suite('ViewStateManager', () => {
    let clock: sinon.SinonFakeTimers

    setup(() => {
        clock = sinon.useFakeTimers()
    })

    teardown(() => {
        clock.restore()
    })

    // save() captures every persisted piece so a hidden tab can be rebuilt as the user left it
    test('save persists scroll position, selection, column widths, and class', () => {
        // Setup
        const api = createMockApi()
        const selection = new SelectionModel()
        selection.select(5, 10)
        const layout = createLayout(10)
        layout.setWidth(5, 150)
        const manager = new ViewStateManager(api, selection, layout, createScrollContainer(240, 800))

        // Exercise
        manager.save(createMetadata('double', 100, 100))

        // Verify
        const saved: GridViewState = api.setState.firstCall.args[0]
        expect(saved.matlabClass).to.equal('double')
        expect(saved.viewport.scroll).to.deep.equal({ scrollTop: 240, scrollLeft: 800 })
        expect(saved.viewport.selection).to.deep.equal({ row: 5, col: 10 })
        expect(saved.columnWidths).to.deep.equal([{ index: 5, width: 150 }])
    })

    // A user who only scrolled has no selection; that must round-trip as null rather than a default cell
    test('save persists null selection when no cell selected', () => {
        // Setup
        const api = createMockApi()
        const manager = new ViewStateManager(api, new SelectionModel(), createLayout(10), createScrollContainer(100, 0))

        // Exercise
        manager.save(createMetadata('double', 100, 100))

        // Verify
        const saved: GridViewState = api.setState.firstCall.args[0]
        expect(saved.viewport.selection).to.equal(null)
    })

    // Unresized columns use default sizing, so only resized ones need to be stored
    test('save persists an empty width list when no column was resized', () => {
        // Setup
        const api = createMockApi()
        const manager = new ViewStateManager(api, new SelectionModel(), createLayout(10), createScrollContainer(0, 0))

        // Exercise
        manager.save(createMetadata('double', 100, 100))

        // Verify
        const saved: GridViewState = api.setState.firstCall.args[0]
        expect(saved.columnWidths).to.deep.equal([])
    })

    // Unchanged variable: the user must land exactly where they left off
    test('restore returns viewport and column widths when valid', () => {
        // Setup
        const api = createMockApi()
        const savedState = createSavedState('double', { row: 5, col: 10 })
        api.getState.returns(savedState)
        const manager = new ViewStateManager(api, new SelectionModel(), createLayout(100), createScrollContainer(0, 0))

        // Exercise
        const result = manager.restore(createMetadata('double', 100, 100))

        // Verify
        expect(result).to.deep.equal({ viewport: savedState.viewport, columnWidths: savedState.columnWidths })
        expect(api.setState.called).to.equal(false)
    })

    // First open of a tab has nothing to restore
    test('restore returns null when no saved state', () => {
        // Setup
        const api = createMockApi()
        const manager = new ViewStateManager(api, new SelectionModel(), createLayout(10), createScrollContainer(0, 0))

        // Exercise
        const result = manager.restore(createMetadata('double', 100, 100))

        // Verify
        expect(result).to.equal(null)
    })

    // A class change means the grid shows different data, so no part of the saved state is meaningful
    test('restore discards everything when class changed', () => {
        // Setup
        const api = createMockApi()
        api.getState.returns(createSavedState('double', { row: 5, col: 10 }))
        const manager = new ViewStateManager(api, new SelectionModel(), createLayout(100), createScrollContainer(0, 0))

        // Exercise
        const result = manager.restore(createMetadata('int32', 100, 100))

        // Verify
        expect(result).to.equal(null)
        expect(api.setState.calledOnceWithExactly(null)).to.equal(true)
    })

    // Rows shrank past the selection: the viewport is meaningless, but resized columns still exist
    test('restore drops viewport but keeps column widths when selection row out of bounds', () => {
        // Setup
        const api = createMockApi()
        api.getState.returns(createSavedState('double', { row: 500, col: 10 }))
        const manager = new ViewStateManager(api, new SelectionModel(), createLayout(50), createScrollContainer(0, 0))

        // Exercise
        const result = manager.restore(createMetadata('double', 50, 50))

        // Verify
        expect(result?.viewport).to.equal(null)
        expect(result?.columnWidths).to.deep.equal([{ index: 5, width: 150 }])
    })

    // Columns shrank past the selection: same split as the row case
    test('restore drops viewport but keeps column widths when selection col out of bounds', () => {
        // Setup
        const api = createMockApi()
        api.getState.returns(createSavedState('double', { row: 10, col: 500 }))
        const manager = new ViewStateManager(api, new SelectionModel(), createLayout(50), createScrollContainer(0, 0))

        // Exercise
        const result = manager.restore(createMetadata('double', 50, 50))

        // Verify
        expect(result?.viewport).to.equal(null)
        expect(result?.columnWidths).to.deep.equal([{ index: 5, width: 150 }])
    })

    // A user who scrolled but never selected still gets their scroll position back
    test('restore returns viewport when selection is null', () => {
        // Setup
        const api = createMockApi()
        const savedState = createSavedState('double', null)
        api.getState.returns(savedState)
        const manager = new ViewStateManager(api, new SelectionModel(), createLayout(100), createScrollContainer(0, 0))

        // Exercise
        const result = manager.restore(createMetadata('double', 100, 100))

        // Verify
        expect(result?.viewport).to.deep.equal(savedState.viewport)
    })

    // Scroll fires many events per second; persisting each one would be wasteful
    test('scheduleSave debounces rapid calls into one save', () => {
        // Setup
        const api = createMockApi()
        const manager = new ViewStateManager(api, new SelectionModel(), createLayout(10), createScrollContainer(0, 0))
        const metadata = createMetadata('double', 100, 100)

        // Exercise
        manager.scheduleSave(metadata)
        manager.scheduleSave(metadata)
        manager.scheduleSave(metadata)
        clock.tick(300)

        // Verify
        expect(api.setState.callCount).to.equal(1)
    })

    // The debounced save must capture the latest state, not the state when it was scheduled
    test('scheduleSave captures state at debounce fire time', () => {
        // Setup
        const api = createMockApi()
        const selection = new SelectionModel()
        selection.select(1, 1)
        const layout = createLayout(10)
        const manager = new ViewStateManager(api, selection, layout, createScrollContainer(0, 0))

        // Exercise
        manager.scheduleSave(createMetadata('double', 100, 100))
        selection.select(50, 30)
        layout.setWidth(2, 200)
        clock.tick(300)

        // Verify
        const saved: GridViewState = api.setState.firstCall.args[0]
        expect(saved.viewport.selection).to.deep.equal({ row: 50, col: 30 })
        expect(saved.columnWidths).to.deep.equal([{ index: 2, width: 200 }])
    })

    // Used on variable deletion so a later variable with the same name starts fresh
    test('clear wipes persisted state', () => {
        // Setup
        const api = createMockApi()
        const manager = new ViewStateManager(api, new SelectionModel(), createLayout(10), createScrollContainer(0, 0))

        // Exercise
        manager.clear()

        // Verify
        expect(api.setState.calledOnceWithExactly(null)).to.equal(true)
    })

    // A save firing after the renderer is torn down would read detached DOM state
    test('dispose cancels pending debounced save', () => {
        // Setup
        const api = createMockApi()
        const manager = new ViewStateManager(api, new SelectionModel(), createLayout(10), createScrollContainer(0, 0))

        // Exercise
        manager.scheduleSave(createMetadata('double', 100, 100))
        manager.dispose()
        clock.tick(300)

        // Verify
        expect(api.setState.called).to.equal(false)
    })
})
