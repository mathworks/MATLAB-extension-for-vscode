// Copyright 2026 The MathWorks, Inc.

// Unit tests for extracted grid modules. Each module is tested in isolation
// without DOM dependencies (except where noted).

import { expect } from 'chai'
import { DEFAULT_CONFIG, GridConfig } from '../../variableviewer/grid/GridConfig'
import { ColumnLayout } from '../../variableviewer/grid/ColumnLayout'
import { ViewportModel } from '../../variableviewer/grid/ViewportModel'
import { ChunkCache } from '../../variableviewer/grid/ChunkCache'
import { ScrollEngine } from '../../variableviewer/grid/ScrollEngine'
import { SelectionModel } from '../../variableviewer/grid/SelectionModel'
import { NavigationModel } from '../../variableviewer/grid/NavigationModel'

// ── GridConfig ──────────────────────────────────────────────────

suite('GridConfig', () => {
    test('DEFAULT_CONFIG has expected production values', () => {
        // Setup
        const config = DEFAULT_CONFIG

        // Exercise
        const chunkRows = config.chunkRows
        const chunkCols = config.chunkCols
        const scrollDebounceMs = config.scrollDebounceMs
        const rowHeight = config.rowHeight
        const minColWidth = config.minColWidth
        const maxChunks = config.maxChunks
        const scrollPadding = config.scrollPadding

        // Verify
        expect(chunkRows).to.equal(50)
        expect(chunkCols).to.equal(20)
        expect(scrollDebounceMs).to.equal(100)
        expect(rowHeight).to.equal(24)
        expect(minColWidth).to.equal(80)
        expect(maxChunks).to.equal(64)
        expect(scrollPadding).to.equal(40)
    })
})

// ── ColumnLayout ────────────────────────────────────────────────

suite('ColumnLayout', () => {
    test('uniform widths when no labels provided', () => {
        // Setup
        const layout = new ColumnLayout()
        layout.computeWidths(5)

        // Exercise
        const totalWidth = layout.getTotalWidth()
        const width0 = layout.getWidth(0)
        const width4 = layout.getWidth(4)
        const offset0 = layout.getOffset(0)
        const offset1 = layout.getOffset(1)
        const offset4 = layout.getOffset(4)

        // Verify
        expect(totalWidth).to.equal(5 * 80)
        expect(width0).to.equal(80)
        expect(width4).to.equal(80)
        expect(offset0).to.equal(0)
        expect(offset1).to.equal(80)
        expect(offset4).to.equal(320)
    })

    test('wider columns for long label names', () => {
        // Setup
        const labels = [
            { id: '1', name: 'VeryLongColumnName' },
            { id: '2', name: 'X' }
        ]
        const layout = new ColumnLayout()
        layout.computeWidths(2, labels)
        const expectedWidth = 'VeryLongColumnName'.length * 8 + 16

        // Exercise
        const width0 = layout.getWidth(0)
        const width1 = layout.getWidth(1)
        const totalWidth = layout.getTotalWidth()

        // Verify
        expect(width0).to.equal(expectedWidth)
        expect(width1).to.equal(80)
        expect(totalWidth).to.equal(expectedWidth + 80)
    })

    test('minimum width is enforced for short labels', () => {
        // Setup
        const labels = [{ id: '1', name: 'A' }]
        const layout = new ColumnLayout()
        layout.computeWidths(1, labels)

        // Exercise
        const result = layout.getWidth(0)

        // Verify
        expect(result).to.equal(80)
    })

    test('findColAtOffset returns 0 for empty layout', () => {
        // Setup
        const layout = new ColumnLayout()

        // Exercise
        const result = layout.findColAtOffset(100)

        // Verify
        expect(result).to.equal(0)
    })

    test('findColAtOffset binary search with uniform widths', () => {
        // Setup
        const layout = new ColumnLayout()
        layout.computeWidths(10)

        // Exercise
        const atZero = layout.findColAtOffset(0)
        const at79 = layout.findColAtOffset(79)
        const at80 = layout.findColAtOffset(80)
        const at160 = layout.findColAtOffset(160)
        const at799 = layout.findColAtOffset(799)

        // Verify
        expect(atZero).to.equal(0)
        expect(at79).to.equal(0)
        expect(at80).to.equal(1)
        expect(at160).to.equal(2)
        expect(at799).to.equal(9)
    })

    test('findColAtOffset with variable widths', () => {
        // Setup
        const labels = [
            { id: '1', name: 'LongName12345' },
            { id: '2', name: 'X' },
            { id: '3', name: 'Y' }
        ]
        const layout = new ColumnLayout()
        layout.computeWidths(3, labels)
        const firstWidth = 'LongName12345'.length * 8 + 16

        // Exercise
        const atZero = layout.findColAtOffset(0)
        const atEndOfFirst = layout.findColAtOffset(firstWidth - 1)
        const atStartOfSecond = layout.findColAtOffset(firstWidth)
        const atEndOfSecond = layout.findColAtOffset(firstWidth + 79)
        const atStartOfThird = layout.findColAtOffset(firstWidth + 80)

        // Verify
        expect(atZero).to.equal(0)
        expect(atEndOfFirst).to.equal(0)
        expect(atStartOfSecond).to.equal(1)
        expect(atEndOfSecond).to.equal(1)
        expect(atStartOfThird).to.equal(2)
    })

    test('getColumnCount returns correct count', () => {
        // Setup
        const layout = new ColumnLayout()
        layout.computeWidths(7)

        // Exercise
        const result = layout.getColumnCount()

        // Verify
        expect(result).to.equal(7)
    })

    test('getWidth returns minColWidth for out-of-range index', () => {
        // Setup
        const layout = new ColumnLayout()
        layout.computeWidths(3)

        // Exercise
        const result = layout.getWidth(99)

        // Verify
        expect(result).to.equal(80)
    })

    test('getOffset returns 0 for out-of-range index', () => {
        // Setup
        const layout = new ColumnLayout()
        layout.computeWidths(3)

        // Exercise
        const result = layout.getOffset(99)

        // Verify
        expect(result).to.equal(0)
    })

    test('setWidth updates column and recalculates offsets', () => {
        // Setup
        const layout = new ColumnLayout()
        layout.computeWidths(4)

        // Exercise
        layout.setWidth(1, 120)
        const width1 = layout.getWidth(1)
        const offset2 = layout.getOffset(2)
        const offset3 = layout.getOffset(3)
        const totalWidth = layout.getTotalWidth()

        // Verify
        expect(width1).to.equal(120)
        expect(offset2).to.equal(80 + 120)
        expect(offset3).to.equal(80 + 120 + 80)
        expect(totalWidth).to.equal(80 + 120 + 80 + 80)
    })

    test('setWidth clamps to minimum width', () => {
        // Setup
        const layout = new ColumnLayout()
        layout.computeWidths(3)

        // Exercise
        layout.setWidth(0, 30)
        const width0 = layout.getWidth(0)
        const totalWidth = layout.getTotalWidth()

        // Verify
        expect(width0).to.equal(80)
        expect(totalWidth).to.equal(240)
    })

    test('setWidth is no-op for out-of-range column', () => {
        // Setup
        const layout = new ColumnLayout()
        layout.computeWidths(3)

        // Exercise
        layout.setWidth(-1, 200)
        layout.setWidth(99, 200)
        const totalWidth = layout.getTotalWidth()

        // Verify
        expect(totalWidth).to.equal(240)
    })

    test('findColAtOffset works after setWidth', () => {
        // Setup
        const layout = new ColumnLayout()
        layout.computeWidths(5)
        layout.setWidth(0, 200)

        // Exercise
        const atZero = layout.findColAtOffset(0)
        const at199 = layout.findColAtOffset(199)
        const at200 = layout.findColAtOffset(200)
        const at280 = layout.findColAtOffset(280)

        // Verify
        expect(atZero).to.equal(0)
        expect(at199).to.equal(0)
        expect(at200).to.equal(1)
        expect(at280).to.equal(2)
    })

    test('getMinWidth returns config minimum', () => {
        // Setup
        const layout = new ColumnLayout()

        // Exercise
        const result = layout.getMinWidth()

        // Verify
        expect(result).to.equal(80)
    })
})

// ── ViewportModel ───────────────────────────────────────────────

suite('ViewportModel', () => {
    const smallConfig: GridConfig = { ...DEFAULT_CONFIG, overscanRows: 2, overscanCols: 2 }

    test('setDimensions stores grid size', () => {
        // Setup
        const vm = new ViewportModel()
        vm.setDimensions(100, 50)

        // Exercise
        const result = vm.getDimensions()

        // Verify
        expect(result).to.deep.equal([100, 50])
    })

    test('update computes visible and rendered ranges', () => {
        // Setup
        const vm = new ViewportModel(smallConfig)
        vm.setDimensions(100, 20)
        const layout = new ColumnLayout(smallConfig)
        layout.computeWidths(20)

        // Exercise
        vm.update(0, 0, 240, 400, layout, 20, 15)
        const visible = vm.getVisibleRange()
        const rendered = vm.getRenderedRange()

        // Verify
        expect(visible.startRow).to.equal(0)
        expect(visible.startCol).to.equal(0)
        expect(rendered.startRow).to.equal(0)
        expect(rendered.startCol).to.equal(0)
        expect(rendered.renderedRows).to.be.greaterThan(0)
        expect(rendered.renderedCols).to.be.greaterThan(0)
    })

    test('overscan extends rendered range beyond visible', () => {
        // Setup
        const vm = new ViewportModel(smallConfig)
        vm.setDimensions(100, 20)
        const layout = new ColumnLayout(smallConfig)
        layout.computeWidths(20)

        // Exercise
        vm.update(480, 0, 240, 400, layout, 30, 15)
        const visible = vm.getVisibleRange()
        const rendered = vm.getRenderedRange()

        // Verify
        expect(rendered.startRow).to.be.lessThan(visible.startRow)
        expect(rendered.endRow).to.be.greaterThan(visible.endRow)
    })

    test('rendered range is clamped to grid dimensions', () => {
        // Setup
        const vm = new ViewportModel(smallConfig)
        vm.setDimensions(5, 3)
        const layout = new ColumnLayout(smallConfig)
        layout.computeWidths(3)

        // Exercise
        vm.update(0, 0, 500, 500, layout, 20, 15)
        const rendered = vm.getRenderedRange()

        // Verify
        expect(rendered.endRow).to.be.at.most(4)
        expect(rendered.endCol).to.be.at.most(2)
    })

    test('computeVisibleRangeFromScroll provides chunk-request range', () => {
        // Setup
        const vm = new ViewportModel()
        vm.setDimensions(100, 20)
        const layout = new ColumnLayout()
        layout.computeWidths(20)

        // Exercise
        const range = vm.computeVisibleRangeFromScroll(0, 0, 240, 400, layout)

        // Verify
        expect(range.startRow).to.equal(0)
        expect(range.startCol).to.equal(0)
        expect(range.endRow).to.be.greaterThan(0)
        expect(range.endCol).to.be.greaterThan(0)
    })
})

// ── ChunkCache ──────────────────────────────────────────────────

suite('ChunkCache', () => {
    const tinyConfig: GridConfig = { ...DEFAULT_CONFIG, maxChunks: 3 }

    test('store and get retrieve cell values', () => {
        // Setup
        const cache = new ChunkCache()
        cache.store({ data: [['a', 'b'], ['c', 'd']], startRow: 0, startCol: 0 })

        // Exercise
        const val00 = cache.get(0, 0)
        const val01 = cache.get(0, 1)
        const val10 = cache.get(1, 0)
        const val11 = cache.get(1, 1)

        // Verify
        expect(val00).to.equal('a')
        expect(val01).to.equal('b')
        expect(val10).to.equal('c')
        expect(val11).to.equal('d')
    })

    test('get returns null for missing chunk', () => {
        // Setup
        const cache = new ChunkCache()

        // Exercise
        const result = cache.get(5, 5)

        // Verify
        expect(result).to.be.null
    })

    test('get returns null for out-of-range local index', () => {
        // Setup
        const cache = new ChunkCache()
        cache.store({ data: [['x']], startRow: 0, startCol: 0 })

        // Exercise
        const outOfRow = cache.get(1, 0)
        const outOfCol = cache.get(0, 1)

        // Verify
        expect(outOfRow).to.be.null
        expect(outOfCol).to.be.null
    })

    test('markPending and isPending track in-flight requests', () => {
        // Setup
        const cache = new ChunkCache()

        // Exercise
        const beforeMark = cache.isPending('0,0')
        cache.markPending('0,0')
        const afterMark = cache.isPending('0,0')

        // Verify
        expect(beforeMark).to.be.false
        expect(afterMark).to.be.true
    })

    test('store clears pending status', () => {
        // Setup
        const cache = new ChunkCache()
        cache.markPending('0,0')

        // Exercise
        cache.store({ data: [['x']], startRow: 0, startCol: 0 })
        const result = cache.isPending('0,0')

        // Verify
        expect(result).to.be.false
    })

    test('clear resets all state', () => {
        // Setup
        const cache = new ChunkCache()
        cache.store({ data: [['x']], startRow: 0, startCol: 0 })
        cache.markPending('50,0')

        // Exercise
        cache.clear()
        const cellValue = cache.get(0, 0)
        const pending = cache.isPending('50,0')
        const size = cache.size()

        // Verify
        expect(cellValue).to.be.null
        expect(pending).to.be.false
        expect(size).to.equal(0)
    })

    test('LRU eviction removes oldest chunk when maxChunks exceeded', () => {
        // Setup
        const cache = new ChunkCache(tinyConfig)
        cache.store({ data: [['a']], startRow: 0, startCol: 0 })
        cache.store({ data: [['b']], startRow: 50, startCol: 0 })
        cache.store({ data: [['c']], startRow: 100, startCol: 0 })

        // Exercise
        cache.store({ data: [['d']], startRow: 150, startCol: 0 })
        const size = cache.size()
        const evicted = cache.get(0, 0)
        const kept50 = cache.get(50, 0)
        const kept100 = cache.get(100, 0)
        const kept150 = cache.get(150, 0)

        // Verify
        expect(size).to.equal(3)
        expect(evicted).to.be.null
        expect(kept50).to.equal('b')
        expect(kept100).to.equal('c')
        expect(kept150).to.equal('d')
    })

    test('LRU touch-on-access prevents eviction of recently used chunk', () => {
        // Setup
        const cache = new ChunkCache(tinyConfig)
        cache.store({ data: [['a']], startRow: 0, startCol: 0 })
        cache.store({ data: [['b']], startRow: 50, startCol: 0 })
        cache.store({ data: [['c']], startRow: 100, startCol: 0 })
        cache.get(0, 0)

        // Exercise
        cache.store({ data: [['d']], startRow: 150, startCol: 0 })
        const touchedChunk = cache.get(0, 0)
        const evictedChunk = cache.get(50, 0)

        // Verify
        expect(touchedChunk).to.equal('a')
        expect(evictedChunk).to.be.null
    })

    test('getNeededChunks returns unloaded, non-pending chunk keys', () => {
        // Setup
        const cache = new ChunkCache()
        cache.store({ data: [['x']], startRow: 0, startCol: 0 })
        cache.markPending('0,20')

        // Exercise
        const needed = cache.getNeededChunks(
            { startRow: 0, endRow: 49, startCol: 0, endCol: 39 },
            [100, 40]
        )

        // Verify
        expect(needed).to.have.lengthOf(0)
    })

    test('getNeededChunks reports chunks not yet loaded or pending', () => {
        // Setup
        const cache = new ChunkCache()

        // Exercise
        const needed = cache.getNeededChunks(
            { startRow: 0, endRow: 99, startCol: 0, endCol: 19 },
            [100, 20]
        )

        // Verify
        expect(needed).to.have.lengthOf(2)
        expect(needed[0].startRow).to.equal(0)
        expect(needed[1].startRow).to.equal(50)
    })

    test('clearStale removes entries older than maxAge', () => {
        // Setup
        const sinon = require('sinon')
        const clock = sinon.useFakeTimers()
        try {
            const cache = new ChunkCache()
            cache.markPending('0,0')
            cache.markPending('50,0')
            clock.tick(11000)

            // Exercise
            cache.clearStale(10000)
            const pending00 = cache.isPending('0,0')
            const pending50 = cache.isPending('50,0')

            // Verify
            expect(pending00).to.equal(false)
            expect(pending50).to.equal(false)
        } finally {
            clock.restore()
        }
    })

    test('clearStale keeps entries younger than maxAge', () => {
        // Setup
        const sinon = require('sinon')
        const clock = sinon.useFakeTimers()
        try {
            const cache = new ChunkCache()
            cache.markPending('0,0')
            clock.tick(5000)

            // Exercise
            cache.clearStale(10000)
            const result = cache.isPending('0,0')

            // Verify
            expect(result).to.equal(true)
        } finally {
            clock.restore()
        }
    })

    test('isLoaded returns true for stored chunk and false for missing', () => {
        // Setup
        const cache = new ChunkCache()
        cache.store({ data: [['x']], startRow: 0, startCol: 0 })

        // Exercise
        const loaded = cache.isLoaded('0,0')
        const notLoaded = cache.isLoaded('50,0')

        // Verify
        expect(loaded).to.be.true
        expect(notLoaded).to.be.false
    })
})

// ── ColumnLayout (additional edge cases) ────────────────────────

suite('ColumnLayout — edge cases', () => {
    test('computeWidths with zero columns produces empty layout', () => {
        // Setup
        const layout = new ColumnLayout()

        // Exercise
        layout.computeWidths(0)
        const totalWidth = layout.getTotalWidth()
        const colCount = layout.getColumnCount()

        // Verify
        expect(totalWidth).to.equal(0)
        expect(colCount).to.equal(0)
    })

    test('setWidth with value equal to current is a no-op', () => {
        // Setup
        const layout = new ColumnLayout()
        layout.computeWidths(3)

        // Exercise
        layout.setWidth(1, 80)
        const totalWidth = layout.getTotalWidth()

        // Verify
        expect(totalWidth).to.equal(240)
    })
})

// ── ScrollEngine ────────────────────────────────────────────────

suite('ScrollEngine', () => {
    let clock: { tick: (ms: number) => void, restore: () => void }

    setup(() => {
        clock = { tick: () => {}, restore: () => {} }
        const sinon = require('sinon')
        clock = sinon.useFakeTimers()
    })

    teardown(() => {
        clock.restore()
    })

    test('onSettle callback fires after debounce delay', () => {
        // Setup
        const engine = new ScrollEngine()
        let settled = false
        engine.onSettle(() => { settled = true })

        // Exercise
        engine.handleScroll(100, 0)
        clock.tick(100)
        const result = settled

        // Verify
        expect(result).to.be.true
        engine.dispose()
    })

    test('rapid scrolls reset the debounce timer', () => {
        // Setup
        const engine = new ScrollEngine()
        let settleCount = 0
        engine.onSettle(() => { settleCount++ })

        // Exercise
        engine.handleScroll(100, 0)
        clock.tick(50)
        engine.handleScroll(200, 0)
        clock.tick(50)
        engine.handleScroll(300, 0)
        clock.tick(100)
        const result = settleCount

        // Verify
        expect(result).to.equal(1)
        engine.dispose()
    })

    test('getPosition returns last scroll values', () => {
        // Setup
        const engine = new ScrollEngine()

        // Exercise
        engine.handleScroll(42, 17)
        const result = engine.getPosition()

        // Verify
        expect(result).to.deep.equal({ scrollTop: 42, scrollLeft: 17 })
        engine.dispose()
    })

    test('dispose clears pending timer', () => {
        // Setup
        const engine = new ScrollEngine()
        let settled = false
        engine.onSettle(() => { settled = true })

        // Exercise
        engine.handleScroll(100, 0)
        engine.dispose()
        clock.tick(200)
        const result = settled

        // Verify
        expect(result).to.be.false
    })

    test('getPosition returns zeros before any scroll', () => {
        // Setup
        const engine = new ScrollEngine()

        // Exercise
        const result = engine.getPosition()

        // Verify
        expect(result).to.deep.equal({ scrollTop: 0, scrollLeft: 0 })
        engine.dispose()
    })

    test('handleScroll without onSettle callback does not throw', () => {
        // Setup
        const engine = new ScrollEngine()

        // Exercise
        engine.handleScroll(100, 50)
        clock.tick(100)
        const result = engine.getPosition()

        // Verify
        expect(result).to.deep.equal({ scrollTop: 100, scrollLeft: 50 })
        engine.dispose()
    })
})

// ── SelectionModel ──────────────────────────────────────────────

suite('SelectionModel', () => {
    test('initially no cell selected', () => {
        // Setup
        const model = new SelectionModel()

        // Exercise
        const selected = model.getSelected()
        const isSelected = model.isSelected(1, 1)

        // Verify
        expect(selected).to.be.null
        expect(isSelected).to.be.false
    })

    test('select stores cell coordinates', () => {
        // Setup
        const model = new SelectionModel()

        // Exercise
        model.select(3, 5)
        const selected = model.getSelected()
        const isSelectedCorrect = model.isSelected(3, 5)
        const isSelectedWrong = model.isSelected(3, 4)

        // Verify
        expect(selected).to.deep.equal({ row: 3, col: 5 })
        expect(isSelectedCorrect).to.be.true
        expect(isSelectedWrong).to.be.false
    })

    test('clear removes selection', () => {
        // Setup
        const model = new SelectionModel()
        model.select(1, 1)

        // Exercise
        model.clear()
        const selected = model.getSelected()
        const isSelected = model.isSelected(1, 1)

        // Verify
        expect(selected).to.be.null
        expect(isSelected).to.be.false
    })

    test('select replaces previous selection', () => {
        // Setup
        const model = new SelectionModel()
        model.select(1, 1)

        // Exercise
        model.select(2, 3)
        const selected = model.getSelected()
        const oldSelected = model.isSelected(1, 1)

        // Verify
        expect(selected).to.deep.equal({ row: 2, col: 3 })
        expect(oldSelected).to.be.false
    })
})

// ── NavigationModel ─────────────────────────────────────────────

suite('NavigationModel', () => {
    const nav = new NavigationModel()
    const dims: [number, number] = [10, 5]

    test('ArrowDown moves row forward', () => {
        // Setup
        const position = { row: 3, col: 2 }

        // Exercise
        const result = nav.computeMove('ArrowDown', position, dims)

        // Verify
        expect(result).to.deep.equal({ row: 4, col: 2 })
    })

    test('ArrowUp moves row backward', () => {
        // Setup
        const position = { row: 3, col: 2 }

        // Exercise
        const result = nav.computeMove('ArrowUp', position, dims)

        // Verify
        expect(result).to.deep.equal({ row: 2, col: 2 })
    })

    test('ArrowRight moves column forward', () => {
        // Setup
        const position = { row: 3, col: 2 }

        // Exercise
        const result = nav.computeMove('ArrowRight', position, dims)

        // Verify
        expect(result).to.deep.equal({ row: 3, col: 3 })
    })

    test('ArrowLeft moves column backward', () => {
        // Setup
        const position = { row: 3, col: 2 }

        // Exercise
        const result = nav.computeMove('ArrowLeft', position, dims)

        // Verify
        expect(result).to.deep.equal({ row: 3, col: 1 })
    })

    test('ArrowDown at last row returns null', () => {
        // Setup
        const position = { row: 10, col: 2 }

        // Exercise
        const result = nav.computeMove('ArrowDown', position, dims)

        // Verify
        expect(result).to.be.null
    })

    test('ArrowUp at first row returns null', () => {
        // Setup
        const position = { row: 1, col: 2 }

        // Exercise
        const result = nav.computeMove('ArrowUp', position, dims)

        // Verify
        expect(result).to.be.null
    })

    test('ArrowRight at last column returns null', () => {
        // Setup
        const position = { row: 3, col: 5 }

        // Exercise
        const result = nav.computeMove('ArrowRight', position, dims)

        // Verify
        expect(result).to.be.null
    })

    test('ArrowLeft at first column returns null', () => {
        // Setup
        const position = { row: 3, col: 1 }

        // Exercise
        const result = nav.computeMove('ArrowLeft', position, dims)

        // Verify
        expect(result).to.be.null
    })

    test('unrecognized key returns null', () => {
        // Setup
        const position = { row: 3, col: 2 }

        // Exercise
        const result = nav.computeMove('Enter', position, dims)

        // Verify
        expect(result).to.be.null
    })
})
