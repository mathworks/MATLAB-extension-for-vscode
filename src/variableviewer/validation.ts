// Copyright 2026 The MathWorks, Inc.

import { VariableMetadata, RendererType, SUPPORTED_NUMERIC_CLASSES, SUPPORTED_TABULAR_CLASSES } from './types'

export { RendererType }

/**
 * Determines which content renderer should be used to display a variable based on its metadata.
 * Variables that are numeric or tabular, non-sparse, non-tall, and 2-D get the grid renderer;
 * all others fall back to the unsupported renderer with a text preview.
 * @param metadata - The variable's type and shape information from the server.
 * @returns The renderer type to use for this variable.
 */
export function selectRenderer (metadata: VariableMetadata): RendererType {
    const isNumeric = SUPPORTED_NUMERIC_CLASSES.has(metadata.dataType)
    const isTabular = SUPPORTED_TABULAR_CLASSES.has(metadata.dataType)

    if (!isNumeric && !isTabular) return 'unsupported'
    if (metadata.isSparse) return 'unsupported'
    if (metadata.isTall) return 'unsupported'
    if (metadata.size.length > 2) return 'unsupported'
    return 'grid'
}
