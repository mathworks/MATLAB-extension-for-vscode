// Copyright 2026 The MathWorks, Inc.

// Tests for the static version gate methods on WorkspaceBrowserProvider.
// The version gate determines whether the connected MATLAB release supports
// the workspace browser feature (requires R2023a or later).

import { expect } from 'chai'
import WorkspaceBrowserProvider from '../../../workspacebrowser/WorkspaceBrowserProvider'
import { getUnsupportedHtml, getDisconnectedHtml } from '../../../workspacebrowser/templates'

suite('WorkspaceBrowserProvider — version gate', () => {
    // The workspace browser depends on server-side APIs introduced in R2023a.
    // The version gate prevents the provider from attempting to use these APIs
    // with older MATLAB releases, which would cause silent failures or crashes.
    // The gate is checked both on initial webview resolve and on MATLAB connect,
    // so it must handle every format the MVM might report.

    suite('isSupported', () => {
        // Supported releases: year >= 2023
        test('R2024a is supported', () => {
            expect(WorkspaceBrowserProvider.isSupported('R2024a')).to.be.true
        })

        test('R2023a is the minimum supported release', () => {
            expect(WorkspaceBrowserProvider.isSupported('R2023a')).to.be.true
        })

        test('R2023b is supported', () => {
            expect(WorkspaceBrowserProvider.isSupported('R2023b')).to.be.true
        })

        test('R2025a is supported', () => {
            expect(WorkspaceBrowserProvider.isSupported('R2025a')).to.be.true
        })

        // Unsupported releases: year < 2023
        test('R2022b is not supported', () => {
            expect(WorkspaceBrowserProvider.isSupported('R2022b')).to.be.false
        })

        test('R2020a is not supported', () => {
            expect(WorkspaceBrowserProvider.isSupported('R2020a')).to.be.false
        })

        // Edge cases: null, empty, and malformed strings can arrive when MATLAB
        // has not fully initialized or the release string is corrupted. The gate
        // must reject all of these rather than throwing or misinterpreting them.
        test('null release returns false', () => {
            expect(WorkspaceBrowserProvider.isSupported(null)).to.be.false
        })

        test('empty string returns false', () => {
            expect(WorkspaceBrowserProvider.isSupported('')).to.be.false
        })

        test('lowercase r2024a is supported (case insensitive)', () => {
            expect(WorkspaceBrowserProvider.isSupported('r2024a')).to.be.true
        })
    })

    suite('getUnsupportedHtml', () => {
        test('returns HTML mentioning R2023a', () => {
            const html = getUnsupportedHtml()
            expect(html).to.include('R2023a')
            expect(html).to.include('or later')
        })
    })

    suite('getDisconnectedHtml', () => {
        test('returns HTML mentioning disconnected state', () => {
            const html = getDisconnectedHtml()
            expect(html).to.include('Disconnected')
        })
    })
})
