// Copyright 2026 The MathWorks, Inc.

export interface MatlabTestInfo {
    name: string
    filename: string
    procedureName: string
    testParentName: string
    parameterization: string
}

export interface TestDiscoveryRawResult {
    names: unknown
    filenames: unknown
    procedureNames: unknown
    testParentNames: unknown
    parameterizations: unknown
    error: string
    warning: string
}

export interface TestRunEvent {
    type: 'started' | 'finished' | 'complete'
    testName: string
    status?: 'passed' | 'failed' | 'incomplete'
    duration?: number
    diagnostics?: TestDiagnosticInfo[]
}

export interface TestDiagnosticInfo {
    message: string
    failedOnLine: number
    failedInFile: string
    stack: StackFrame[]
}

export interface StackFrame {
    file: string
    name: string
    line: number
}

export interface TestRunRequest {
    runId: string
    testFiles: string[]
    testNames?: string[]
}

export interface TestRunEventNotification {
    runId: string
    event: Record<string, unknown>
}

export interface TestRunCompleteNotification {
    runId: string
    error?: string
}
