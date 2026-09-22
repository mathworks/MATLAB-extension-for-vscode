// Copyright 2026 The MathWorks, Inc.

import { RendererType, SUPPORTED_NUMERIC_CLASSES, SUPPORTED_TABULAR_CLASSES } from './types'

const UNSUPPORTED_TYPE_MAP: ReadonlyMap<string, string> = new Map([
    ['char', 'char_disp'],
    ['string', 'string_disp'],
    ['cell', 'cell_disp'],
    ['datetime', 'datetime_disp'],
    ['duration', 'duration_disp'],
    ['categorical', 'categorical_disp'],
    ['timetable', 'timetable_disp']
])

/**
 * Maps a MATLAB variable's type, renderer, and size to a DDUX elementId
 * that identifies the variable's view category for telemetry.
 * @param dataType - The MATLAB class name (e.g. 'double', 'struct', 'table').
 * @param rendererType - The renderer used to display the variable.
 * @param size - The variable's dimensions array.
 * @returns The elementId string (e.g. 'numeric_table', 'struct_tree', 'object_disp').
 */
export function getElementId (dataType: string, rendererType: RendererType, size: readonly number[]): string {
    if (rendererType === 'grid') {
        if (SUPPORTED_NUMERIC_CLASSES.has(dataType)) return 'numeric_table'
        if (SUPPORTED_TABULAR_CLASSES.has(dataType)) return 'table_table'
    }

    const mapped = UNSUPPORTED_TYPE_MAP.get(dataType)
    if (mapped != null) return mapped

    if (dataType === 'struct') return 'struct_disp'

    if (dataType === 'table') return 'table_disp'

    if (SUPPORTED_NUMERIC_CLASSES.has(dataType)) return 'object_disp'

    const isScalar = size.length === 2 && size[0] === 1 && size[1] === 1
    if (isScalar) return 'object_disp'

    if (size.some(d => d > 1)) return 'objectarray_disp'

    return 'object_disp'
}

/**
 * Produces a deterministic, non-reversible hash of a variable name for telemetry.
 * Uses the djb2 algorithm to avoid sending actual variable names.
 * @param varName - The MATLAB workspace variable name.
 * @returns A hex string hash of the variable name.
 */
export function hashVariableName (varName: string): string {
    let hash = 5381
    for (let i = 0; i < varName.length; i++) {
        hash = ((hash << 5) + hash + varName.charCodeAt(i)) | 0
    }
    return (hash >>> 0).toString(16)
}

/**
 * Formats a variable's size array into the DDUX dimensions string.
 * @param size - The variable's dimensions array.
 * @returns A bracket-delimited string (e.g. '[3,4]').
 */
export function formatDimensions (size: readonly number[]): string {
    return '[' + size.join(',') + ']'
}
