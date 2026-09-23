// Copyright 2026 The MathWorks, Inc.

import { CellPage } from '../types'
import { GridConfig, DEFAULT_CONFIG } from './GridConfig'
import { ViewportRange } from './ViewportModel'

/** Describes a data chunk that needs to be fetched from the server. */
export interface ChunkRequest {
    /** Cache key identifying this chunk's position (e.g. "0,0", "50,20"). */
    readonly key: string
    /** 0-based starting row of the chunk. */
    readonly startRow: number
    /** 0-based starting column of the chunk. */
    readonly startCol: number
}

/**
 * LRU cache of rectangular data chunks fetched from the server.
 * Manages chunk storage, pending-request tracking, staleness detection,
 * and determines which chunks are needed for the current viewport.
 */
export class ChunkCache {
    private readonly chunks = new Map<string, string[][]>()
    private readonly pending = new Map<string, number>()
    private lastTouchedKey: string = ''

    constructor (private readonly config: GridConfig = DEFAULT_CONFIG) {}

    /**
     * Stores a page of cell data in the cache, keyed by its origin coordinates.
     * Triggers LRU eviction if the cache exceeds the configured maximum.
     * @param page - The cell page to store, containing data and origin coordinates.
     */
    store (page: CellPage): void {
        const key = this.chunkKey(page.startRow, page.startCol)
        this.chunks.delete(key)
        this.chunks.set(key, page.data as string[][])
        this.pending.delete(key)
        this.evict()
    }

    /**
     * Retrieves a single cell value by its 0-based row and column index.
     * Promotes the containing chunk to the most-recently-used position.
     * @param row - 0-based row index of the cell.
     * @param col - 0-based column index of the cell.
     * @returns The cell's string value, or null if the chunk is not loaded.
     */
    get (row: number, col: number): string | null {
        const chunkRow = Math.floor(row / this.config.chunkRows) * this.config.chunkRows
        const chunkCol = Math.floor(col / this.config.chunkCols) * this.config.chunkCols
        const key = this.chunkKey(chunkRow, chunkCol)
        const chunk = this.chunks.get(key)
        if (chunk == null) return null

        if (this.lastTouchedKey !== key) {
            this.chunks.delete(key)
            this.chunks.set(key, chunk)
            this.lastTouchedKey = key
        }

        const localRow = row - chunkRow
        const localCol = col - chunkCol
        if (localRow >= chunk.length) return null
        const rowData = chunk[localRow]
        if (localCol >= rowData.length) return null
        return rowData[localCol]
    }

    /**
     * Marks a chunk as having a pending fetch request, recording the current timestamp.
     * @param key - The chunk cache key to mark as pending.
     */
    markPending (key: string): void {
        this.pending.set(key, Date.now())
    }

    /**
     * Tests whether a chunk currently has a pending fetch request.
     * @param key - The chunk cache key to check.
     * @returns True if the chunk is awaiting data from the server.
     */
    isPending (key: string): boolean {
        return this.pending.has(key)
    }

    /**
     * Removes pending entries that have exceeded the given age, allowing re-fetch.
     * @param maxAgeMs - Maximum age in milliseconds before a pending request is considered stale.
     */
    clearStale (maxAgeMs: number): void {
        const now = Date.now()
        for (const [key, timestamp] of this.pending) {
            if (now - timestamp > maxAgeMs) {
                this.pending.delete(key)
            }
        }
    }

    /**
     * Tests whether a chunk's data is already loaded in the cache.
     * @param key - The chunk cache key to check.
     * @returns True if the chunk data is available.
     */
    isLoaded (key: string): boolean {
        return this.chunks.has(key)
    }

    /**
     * Determines which chunks covering the given viewport range are neither loaded nor pending.
     * @param range - The visible viewport range to cover.
     * @param dimensions - Tuple of [totalRows, totalCols] for clamping.
     * @returns An array of chunk requests that need to be sent to the server.
     */
    getNeededChunks (range: ViewportRange, dimensions: [number, number]): ChunkRequest[] {
        const [numRows, numCols] = dimensions
        const needed: ChunkRequest[] = []

        const startChunkRow = Math.floor(range.startRow / this.config.chunkRows) * this.config.chunkRows
        const endChunkRow = Math.min(Math.floor(range.endRow / this.config.chunkRows) * this.config.chunkRows, numRows - 1)
        const startChunkCol = Math.floor(range.startCol / this.config.chunkCols) * this.config.chunkCols
        const endChunkCol = Math.min(Math.floor(range.endCol / this.config.chunkCols) * this.config.chunkCols, numCols - 1)

        for (let r = startChunkRow; r <= endChunkRow; r += this.config.chunkRows) {
            for (let c = startChunkCol; c <= endChunkCol; c += this.config.chunkCols) {
                const key = this.chunkKey(r, c)
                if (!this.chunks.has(key) && !this.pending.has(key)) {
                    needed.push({ key, startRow: r, startCol: c })
                }
            }
        }

        return needed
    }

    /** Clears all cached data and pending requests. */
    clear (): void {
        this.chunks.clear()
        this.pending.clear()
        this.lastTouchedKey = ''
    }

    /**
     * Returns the number of data chunks currently stored in the cache.
     * @returns The chunk count.
     */
    size (): number {
        return this.chunks.size
    }

    /** Evicts the oldest chunks when the cache exceeds the configured maximum size. */
    private evict (): void {
        while (this.chunks.size > this.config.maxChunks) {
            const oldest = this.chunks.keys().next().value
            if (oldest != null) {
                this.chunks.delete(oldest)
            }
        }
    }

    /**
     * Generates a cache key string from chunk origin coordinates.
     * @param startRow - 0-based starting row of the chunk.
     * @param startCol - 0-based starting column of the chunk.
     * @returns The cache key string.
     */
    private chunkKey (startRow: number, startCol: number): string {
        return `${startRow},${startCol}`
    }
}
