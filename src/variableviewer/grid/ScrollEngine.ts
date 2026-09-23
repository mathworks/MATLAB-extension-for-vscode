// Copyright 2026 The MathWorks, Inc.

import { GridConfig, DEFAULT_CONFIG } from './GridConfig'

/**
 * Debounces scroll events and fires a settle callback once scrolling stops.
 * Used to defer expensive data-fetch operations until the user finishes scrolling.
 */
export class ScrollEngine {
    private scrollTop: number = 0
    private scrollLeft: number = 0
    private debounceTimer: ReturnType<typeof setTimeout> | undefined
    private settleCallback: (() => void) | null = null

    constructor (private readonly config: GridConfig = DEFAULT_CONFIG) {}

    /**
     * Registers a callback to be invoked once scrolling has settled (no scroll events
     * within the debounce window).
     * @param callback - The function to call when scroll settles.
     */
    onSettle (callback: () => void): void {
        this.settleCallback = callback
    }

    /**
     * Records a new scroll position and resets the debounce timer.
     * @param scrollTop - Current vertical scroll offset in pixels.
     * @param scrollLeft - Current horizontal scroll offset in pixels.
     */
    handleScroll (scrollTop: number, scrollLeft: number): void {
        this.scrollTop = scrollTop
        this.scrollLeft = scrollLeft

        if (this.debounceTimer != null) {
            clearTimeout(this.debounceTimer)
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined
            if (this.settleCallback != null) {
                this.settleCallback()
            }
        }, this.config.scrollDebounceMs)
    }

    /**
     * Returns the most recently recorded scroll position.
     * @returns An object with scrollTop and scrollLeft pixel offsets.
     */
    getPosition (): { scrollTop: number, scrollLeft: number } {
        return { scrollTop: this.scrollTop, scrollLeft: this.scrollLeft }
    }

    /** Cancels any pending debounce timer and removes the settle callback. */
    dispose (): void {
        if (this.debounceTimer != null) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = undefined
        }
        this.settleCallback = null
    }
}
