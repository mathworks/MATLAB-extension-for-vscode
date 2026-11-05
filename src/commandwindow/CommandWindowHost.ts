// Copyright 2026 The MathWorks, Inc.

/**
 * The services the command window needs from the application hosting it.
 */
export interface CommandWindowHost {
    writeClipboard: (text: string) => void
    readClipboard: () => Promise<string>
    setHasSelection: (hasSelection: boolean) => void
    revealCommandWindow: () => void
    // Without a tokenizer, the command line is not colored
    createTokenizer?: () => Promise<LineTokenizer | undefined>
    // Send the terminal size before every command, for when something else, such as the
    // MATLAB desktop, can change MATLAB's Command Window size
    alwaysSendDimensions?: boolean
}

/**
 * Tokenizes the command line for syntax coloring. The first token must start at index 0.
 */
export interface LineTokenizer {
    tokenizeLine: (line: string) => LineToken[]
    dispose?: () => void
}

/**
 * A colored run of a line. It ends where the next token starts.
 */
export interface LineToken {
    startIndex: number
    color?: string // '#rrggbb', or undefined for the default foreground
}
