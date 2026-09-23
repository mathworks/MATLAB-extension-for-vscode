// Copyright 2026 The MathWorks, Inc.

// Tests for the Variable Viewer webview module: verifies grid rendering,
// on-demand data loading, cell selection, keyboard navigation, special value
// display, type transitions, and MATLAB state handling.

import { expect } from 'chai'
import * as sinon from 'sinon'
import { PanelHost } from '../../variableviewer/webview-host'
import { ExtToVVWebview, VariableMetadata, LabelInfo } from '../../variableviewer/types'

// ── Helpers ──────────────────────────────────────────────────────

interface MockApi {
    postMessage: sinon.SinonStub
}

/**
 * Sets up the minimal shell DOM and creates a PanelHost instance.
 * Returns the mock API and the host for direct message dispatch.
 */
function setupWebview (): { api: MockApi, host: PanelHost } {
    document.body.innerHTML = ''
    document.body.dataset.varName = 'testVar'

    const container = document.createElement('div')
    container.className = 'vv-container'

    // Banner
    const banner = document.createElement('div')
    banner.className = 'vv-banner'
    banner.innerHTML = '<span class="vv-banner-name"></span><span class="vv-banner-meta"></span>'
    container.appendChild(banner)

    // Content root — renderers mount their DOM here
    const contentRoot = document.createElement('div')
    contentRoot.className = 'vv-content-root'
    container.appendChild(contentRoot)

    document.body.appendChild(container)

    const api: MockApi = { postMessage: sinon.stub() }
    const host = new PanelHost(api)
    host.init()

    // Stub clientHeight/clientWidth on .vv-grid-wrap after grid renderer creates it
    const origHandleMessage = host.handleMessage.bind(host)
    host.handleMessage = (msg: ExtToVVWebview) => {
        origHandleMessage(msg)
        // After a grid response, stub layout properties on the newly created grid wrap
        const gridWrap = document.querySelector('.vv-grid-wrap')
        if (gridWrap != null && !(gridWrap as any).__stubbed) {
            Object.defineProperty(gridWrap, 'clientHeight', { value: 600, configurable: true })
            Object.defineProperty(gridWrap, 'clientWidth', { value: 800, configurable: true })
            Object.defineProperty(gridWrap, 'scrollTop', { value: 0, configurable: true, writable: true })
            Object.defineProperty(gridWrap, 'scrollLeft', { value: 0, configurable: true, writable: true })
            ;(gridWrap as any).__stubbed = true
        }
    }

    return { api, host }
}

/**
 * Sends a variableResponse with cell data for a supported numeric type.
 */
function sendNumericResponse (host: PanelHost, rows: number, cols: number, className: string = 'double', cellData?: string[][]): void {
    const metadata: VariableMetadata = {
        dataType: className,
        size: [rows, cols],
        isSparse: false,
        isTall: false
    }

    const data: string[][] = cellData ?? Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => `${r + 1}.${c + 1}`)
    )

    host.handleMessage({
        type: 'variableResponse',
        varName: 'testVar',
        metadata,
        rendererType: 'grid',
        cells: { data, startRow: 0, startCol: 0 }
    })
}

/**
 * Sends a variableResponse with preview text for an unsupported type.
 */
function sendUnsupportedResponse (host: PanelHost, className: string = 'struct', preview: string = ''): void {
    const metadata: VariableMetadata = {
        dataType: className,
        size: [1, 1],
        isSparse: false,
        isTall: false
    }

    host.handleMessage({
        type: 'variableResponse',
        varName: 'testVar',
        metadata,
        rendererType: 'unsupported',
        preview: preview || `[1x1 ${className}]`
    })
}

// ── Tests ────────────────────────────────────────────────────────

suite('Variable Viewer Webview', () => {
    teardown(() => {
        sinon.restore()
    })

    // Verifies that the webview signals readiness to the extension host on initialization
    test('init posts ready message', () => {
        // Setup
        const { api } = setupWebview()

        // Exercise
        const readyMsg = api.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'ready'
        )

        // Verify
        expect(readyMsg).to.not.be.undefined
    })

    // Verifies that receiving a variableResponse renders the banner with name, size, and class
    test('variableResponse renders banner with name and dimensions', () => {
        // Setup
        const { host } = setupWebview()

        // Exercise
        sendNumericResponse(host, 3, 4)
        const bannerName = document.querySelector('.vv-banner-name') as HTMLElement
        const bannerMeta = document.querySelector('.vv-banner-meta') as HTMLElement

        // Verify
        expect(bannerName.textContent).to.equal('testVar')
        expect(bannerMeta.textContent).to.equal('3x4 double')
    })

    // Verifies that a 3x4 matrix creates correct grid headers with 1-based indices
    test('variableResponse for numeric type renders grid headers with 1-based indices', () => {
        // Setup
        const { host } = setupWebview()

        // Exercise
        sendNumericResponse(host, 3, 4)
        const colHeaders = document.querySelectorAll('.vv-col-header')
        const rowHeaders = document.querySelectorAll('.vv-row-header')

        // Verify
        expect(colHeaders).to.have.lengthOf(4)
        expect(colHeaders[0].textContent).to.equal('1')
        expect(colHeaders[3].textContent).to.equal('4')
        expect(rowHeaders).to.have.lengthOf(3)
        expect(rowHeaders[0].textContent).to.equal('1')
        expect(rowHeaders[2].textContent).to.equal('3')
    })

    // Verifies that cell data from the variableResponse is rendered at correct positions
    test('variableResponse with cells renders string values at correct positions', () => {
        // Setup
        const { host } = setupWebview()

        // Exercise
        sendNumericResponse(host, 3, 3, 'double', [
            ['1.5', '2.5', '3.5'],
            ['4', '5', '6'],
            ['7', '8', '9']
        ])
        const cell11 = document.querySelector('.vv-cell[data-row="1"][data-col="1"]') as HTMLElement
        const cell13 = document.querySelector('.vv-cell[data-row="1"][data-col="3"]') as HTMLElement
        const cell23 = document.querySelector('.vv-cell[data-row="2"][data-col="3"]') as HTMLElement
        const cell32 = document.querySelector('.vv-cell[data-row="3"][data-col="2"]') as HTMLElement

        // Verify
        expect(cell11.textContent).to.equal('1.5')
        expect(cell13.textContent).to.equal('3.5')
        expect(cell23.textContent).to.equal('6')
        expect(cell32.textContent).to.equal('8')
    })

    // Verifies that NaN, Inf, and -Inf are displayed as server-formatted strings
    test('special floating-point values display as text', () => {
        // Setup
        const { host } = setupWebview()

        // Exercise
        sendNumericResponse(host, 1, 3, 'double', [['NaN', 'Inf', '-Inf']])
        const cellNaN = document.querySelector('.vv-cell[data-row="1"][data-col="1"]') as HTMLElement
        const cellInf = document.querySelector('.vv-cell[data-row="1"][data-col="2"]') as HTMLElement
        const cellNegInf = document.querySelector('.vv-cell[data-row="1"][data-col="3"]') as HTMLElement

        // Verify
        expect(cellNaN.textContent).to.equal('NaN')
        expect(cellInf.textContent).to.equal('Inf')
        expect(cellNegInf.textContent).to.equal('-Inf')
    })

    // Verifies that scrolling triggers a requestPage message with viewport bounds
    test('scroll triggers requestPage message with viewport bounds', () => {
        // Setup
        const clock = sinon.useFakeTimers()
        const { api, host } = setupWebview()
        sendNumericResponse(host, 200, 200)
        const gridWrap = document.querySelector('.vv-grid-wrap') as HTMLElement
        Object.defineProperty(gridWrap, 'scrollTop', { value: 1300, configurable: true })
        Object.defineProperty(gridWrap, 'clientHeight', { value: 500, configurable: true })
        Object.defineProperty(gridWrap, 'scrollLeft', { value: 0, configurable: true })
        Object.defineProperty(gridWrap, 'clientWidth', { value: 800, configurable: true })
        api.postMessage.resetHistory()

        // Exercise
        gridWrap.dispatchEvent(new Event('scroll'))
        clock.tick(150)
        const dataRequest = api.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'requestPage' && c.args[0]?.startRow === 50
        )

        // Verify
        expect(dataRequest).to.not.be.undefined
        expect(dataRequest!.args[0].varName).to.equal('testVar')
        clock.restore()
    })

    // Verifies that clicking a cell updates the status bar with index and value
    test('selecting a cell updates status bar with index and value', () => {
        // Setup
        const { host } = setupWebview()
        sendNumericResponse(host, 2, 2, 'double', [['3.14', '2.71'], ['1.41', '1.73']])
        const cell = document.querySelector('.vv-cell[data-row="2"][data-col="1"]') as HTMLElement

        // Exercise
        cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        const statusText = document.querySelector('.vv-status-text') as HTMLElement

        // Verify
        expect(statusText.textContent).to.equal('testVar(2,1) = 1.41')
    })

    // Verifies arrow key navigation moves selection between cells
    test('arrow key navigation moves selected cell', () => {
        // Setup
        const { host } = setupWebview()
        sendNumericResponse(host, 3, 3, 'double', [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']])
        const cell11 = document.querySelector('.vv-cell[data-row="1"][data-col="1"]') as HTMLElement
        cell11.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

        // Exercise
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
        const selected = document.querySelector('.vv-cell-selected') as HTMLElement

        // Verify
        expect(selected.dataset.row).to.equal('1')
        expect(selected.dataset.col).to.equal('2')
    })

    // Verifies that variableDeleted shows the deletion message
    test('variableDeleted shows deletion message', () => {
        // Setup
        const { host } = setupWebview()
        sendNumericResponse(host, 2, 2)

        // Exercise
        host.handleMessage({ type: 'variableDeleted', varName: 'testVar' })
        const contentRoot = document.querySelector('.vv-content-root') as HTMLElement

        // Verify
        expect(contentRoot.innerHTML).to.include('does not exist')
    })

    // Verifies that a scalar (1x1) renders a single-cell grid
    test('scalar renders single-cell grid', () => {
        // Setup
        const { host } = setupWebview()

        // Exercise
        sendNumericResponse(host, 1, 1, 'double', [['42']])
        const colHeaders = document.querySelectorAll('.vv-col-header')
        const rowHeaders = document.querySelectorAll('.vv-row-header')
        const cells = document.querySelectorAll('.vv-cell')

        // Verify
        expect(colHeaders).to.have.lengthOf(1)
        expect(rowHeaders).to.have.lengthOf(1)
        expect(cells).to.have.lengthOf(1)
    })

    // Verifies that a row vector (1xN) renders as a single row with N columns
    test('row vector renders single row with N columns', () => {
        // Setup
        const { host } = setupWebview()

        // Exercise
        sendNumericResponse(host, 1, 5)
        const rowHeaders = document.querySelectorAll('.vv-row-header')
        const colHeaders = document.querySelectorAll('.vv-col-header')

        // Verify
        expect(rowHeaders).to.have.lengthOf(1)
        expect(colHeaders).to.have.lengthOf(5)
    })

    // Verifies that an empty array (0xN) renders the grid scaffolding with column headers but no rows
    test('empty array renders grid with column headers and no data rows', () => {
        // Setup
        const { host } = setupWebview()

        // Exercise
        host.handleMessage({
            type: 'variableResponse',
            varName: 'testVar',
            metadata: { dataType: 'double', size: [0, 3], isSparse: false, isTall: false },
            rendererType: 'grid'
        })
        const banner = document.querySelector('.vv-banner-meta') as HTMLElement
        const gridWrap = document.querySelector('.vv-grid-wrap')
        const colHeaders = document.querySelectorAll('.vv-col-header')
        const cells = document.querySelectorAll('.vv-cell[data-row]')

        // Verify
        expect(banner.textContent).to.equal('0x3 double')
        expect(gridWrap).to.not.equal(null)
        expect(colHeaders).to.have.lengthOf(3)
        expect(cells).to.have.lengthOf(0)
    })

    // Verifies type transition from supported to unsupported switches renderer
    test('type transition supported → unsupported shows preview view', () => {
        // Setup
        const { host } = setupWebview()
        sendNumericResponse(host, 3, 3)

        // Exercise
        sendUnsupportedResponse(host, 'struct', 'Name: [1x1 string]')
        const gridWrap = document.querySelector('.vv-grid-wrap')
        const previewWrap = document.querySelector('.vv-preview-wrap')

        // Verify
        expect(gridWrap).to.be.null
        expect(previewWrap).to.not.be.null
    })

    // Verifies type transition from unsupported to supported switches renderer
    test('type transition unsupported → supported shows grid view', () => {
        // Setup
        const { host } = setupWebview()
        sendUnsupportedResponse(host, 'struct')

        // Exercise
        sendNumericResponse(host, 4, 4)
        const gridWrap = document.querySelector('.vv-grid-wrap')
        const previewWrap = document.querySelector('.vv-preview-wrap')

        // Verify
        expect(gridWrap).to.not.be.null
        expect(previewWrap).to.be.null
    })

    // Verifies that unsupported type response shows the preview view without the grid
    test('unsupported type shows preview view without grid', () => {
        // Setup
        const { host } = setupWebview()

        // Exercise
        sendUnsupportedResponse(host, 'cell')
        const gridWrap = document.querySelector('.vv-grid-wrap')
        const previewWrap = document.querySelector('.vv-preview-wrap')

        // Verify
        expect(gridWrap).to.be.null
        expect(previewWrap).to.not.be.null
    })

    // Verifies that receiving a variableResponse with preview populates the preview text
    test('variableResponse with preview populates preview text', () => {
        // Setup
        const { host } = setupWebview()

        // Exercise
        sendUnsupportedResponse(host, 'struct', 'Name: [1x1 string]\nAge: [1x1 double]')
        const previewText = document.querySelector('.vv-preview-text') as HTMLPreElement

        // Verify
        expect(previewText.textContent).to.include('Name: [1x1 string]')
        expect(previewText.textContent).to.include('Age: [1x1 double]')
    })

    // Verifies that an error message is displayed in the status bar
    test('error message displays in status bar', () => {
        // Setup
        const { host } = setupWebview()
        sendNumericResponse(host, 2, 2)

        // Exercise
        host.handleMessage({
            type: 'error',
            varName: 'testVar',
            requestType: 'QueryVariable',
            message: 'Variable access denied'
        })
        const statusText = document.querySelector('.vv-status-text') as HTMLElement

        // Verify
        expect(statusText.textContent).to.include('Variable access denied')
        expect(statusText.classList.contains('vv-error')).to.equal(true)
    })

    // Verifies that dataStale triggers a new data request for the visible chunk
    test('dataStale re-requests visible data', () => {
        // Setup
        const { api, host } = setupWebview()
        sendNumericResponse(host, 3, 3, 'double', [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']])
        api.postMessage.resetHistory()

        // Exercise
        host.handleMessage({ type: 'dataStale' })
        const dataRequest = api.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'requestPage'
        )

        // Verify
        expect(dataRequest).to.not.be.undefined
    })

    // Verifies that the status bar is cleared when data is invalidated
    test('dataStale clears status bar selection text', () => {
        // Setup
        const { host } = setupWebview()
        sendNumericResponse(host, 2, 2, 'double', [['4', '5'], ['6', '7']])
        const cell = document.querySelector('.vv-cell[data-row="1"][data-col="1"]') as HTMLElement
        cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

        // Exercise
        host.handleMessage({ type: 'dataStale' })
        const statusText = document.querySelector('.vv-status-text') as HTMLElement

        // Verify
        expect(statusText.textContent).to.equal('')
    })

    // Verifies that the status bar is absent when in preview view
    test('type transition to unsupported removes status bar', () => {
        // Setup
        const { host } = setupWebview()
        sendNumericResponse(host, 2, 2)

        // Exercise
        sendUnsupportedResponse(host, 'struct')
        const statusBar = document.querySelector('.vv-status-bar')

        // Verify
        expect(statusBar).to.be.null
    })

    // Verifies that the status bar is present when in grid view
    test('type transition to supported creates status bar', () => {
        // Setup
        const { host } = setupWebview()
        sendUnsupportedResponse(host, 'struct')

        // Exercise
        sendNumericResponse(host, 3, 3)
        const statusBar = document.querySelector('.vv-status-bar')

        // Verify
        expect(statusBar).to.not.be.null
    })
})

// ── Table Support Tests ─────────────────────────────────────────

/**
 * Sends a variableResponse with table metadata including column labels.
 */
function sendTableResponse (host: PanelHost, rows: number, cols: number, columnNames: string[], cellData?: string[][], rowLabels?: LabelInfo[]): void {
    const metadata: VariableMetadata = {
        dataType: 'table',
        size: [rows, cols],
        isSparse: false,
        isTall: false
    }

    const data: string[][] = cellData ?? Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => `cell_${r + 1}_${c + 1}`)
    )

    host.handleMessage({
        type: 'variableResponse',
        varName: 'testVar',
        metadata,
        columns: { labels: columnNames.map((name, i) => ({ id: String(i + 1), name })) },
        rows: rowLabels != null ? { labels: rowLabels } : undefined,
        rendererType: 'grid',
        cells: { data, startRow: 0, startCol: 0 }
    })
}

suite('Variable Viewer Webview — Table Support', () => {
    teardown(() => {
        sinon.restore()
    })

    // Verifies that table response renders named column headers
    test('table renders named column headers', () => {
        // Setup
        const { host } = setupWebview()

        // Exercise
        sendTableResponse(host, 3, 3, ['Name', 'Age', 'Height'])
        const colHeaders = document.querySelectorAll('.vv-col-header')

        // Verify
        expect(colHeaders).to.have.lengthOf(3)
        expect(colHeaders[0].textContent).to.equal('Name')
        expect(colHeaders[1].textContent).to.equal('Age')
        expect(colHeaders[2].textContent).to.equal('Height')
    })

    // Verifies that table without row labels renders 1-based row indices
    test('table without row labels renders 1-based row indices', () => {
        // Setup
        const { host } = setupWebview()

        // Exercise
        sendTableResponse(host, 3, 2, ['A', 'B'])
        const rowHeaders = document.querySelectorAll('.vv-row-header')

        // Verify
        expect(rowHeaders).to.have.lengthOf(3)
        expect(rowHeaders[0].textContent).to.equal('1')
        expect(rowHeaders[1].textContent).to.equal('2')
        expect(rowHeaders[2].textContent).to.equal('3')
    })

    // Verifies that table with row labels renders named row headers
    test('table with row labels renders named row headers', () => {
        // Setup
        const { host } = setupWebview()
        const rowLabels: LabelInfo[] = [
            { id: '1', name: 'Alice' },
            { id: '2', name: 'Bob' },
            { id: '3', name: 'Charlie' }
        ]

        // Exercise
        sendTableResponse(host, 3, 2, ['Score', 'Grade'], undefined, rowLabels)
        const rowHeaders = document.querySelectorAll('.vv-row-header')

        // Verify
        expect(rowHeaders).to.have.lengthOf(3)
        expect(rowHeaders[0].textContent).to.equal('Alice')
        expect(rowHeaders[1].textContent).to.equal('Bob')
        expect(rowHeaders[2].textContent).to.equal('Charlie')
    })

    // Verifies that a long column name widens that column beyond default
    test('long column name widens column beyond minimum', () => {
        // Setup
        const { host } = setupWebview()

        // Exercise
        sendTableResponse(host, 2, 2, ['VeryLongVariableNameForTesting', 'X'])
        const colHeaders = document.querySelectorAll('.vv-col-header')
        const wideHeader = colHeaders[0] as HTMLElement
        const narrowHeader = colHeaders[1] as HTMLElement
        const wideWidth = parseInt(wideHeader.style.width, 10)
        const narrowWidth = parseInt(narrowHeader.style.width, 10)

        // Verify
        expect(wideWidth).to.be.greaterThan(80)
        expect(narrowWidth).to.equal(80)
    })

    // Verifies that table cells display pre-formatted complex values
    test('table with complex cells shows flattened text', () => {
        // Setup
        const { host } = setupWebview()

        // Exercise
        sendTableResponse(host, 2, 3, ['Numbers', 'Matrix', 'Nested'], [
            ['42', '1x3 double', '1x1 table'],
            ['7', '2x2 single', '3x1 cell']
        ])
        const cell12 = document.querySelector('.vv-cell[data-row="1"][data-col="2"]') as HTMLElement
        const cell13 = document.querySelector('.vv-cell[data-row="1"][data-col="3"]') as HTMLElement
        const cell22 = document.querySelector('.vv-cell[data-row="2"][data-col="2"]') as HTMLElement

        // Verify
        expect(cell12.textContent).to.equal('1x3 double')
        expect(cell13.textContent).to.equal('1x1 table')
        expect(cell22.textContent).to.equal('2x2 single')
    })

    // Verifies that table cell selection updates status bar
    test('table cell selection updates status bar', () => {
        // Setup
        const { host } = setupWebview()
        sendTableResponse(host, 2, 2, ['Name', 'Value'], [['Alice', '100'], ['Bob', '200']])
        const cell = document.querySelector('.vv-cell[data-row="1"][data-col="2"]') as HTMLElement

        // Exercise
        cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        const statusText = document.querySelector('.vv-status-text') as HTMLElement

        // Verify
        expect(statusText.textContent).to.equal('testVar(1,2) = 100')
    })

    // Verifies that the banner shows table type info
    test('table response renders banner with table type', () => {
        // Setup
        const { host } = setupWebview()

        // Exercise
        sendTableResponse(host, 5, 3, ['A', 'B', 'C'])
        const bannerMeta = document.querySelector('.vv-banner-meta') as HTMLElement

        // Verify
        expect(bannerMeta.textContent).to.equal('5x3 table')
    })
})
