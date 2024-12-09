// Copyright 2024 The MathWorks, Inc.

export enum Capability {
    InteractiveCommandLine = 'InteractiveCommandLine',
    Swing = 'Swing',
    ComplexSwing = 'ComplexSwing',
    LocalClient = 'LocalClient',
    WebWindow = 'WebWindow',
    ModalDialogs = 'ModalDialogs',
    Debugging = 'Debugging'
}

/**
 * Represents text coming from MATLAB
 */
export interface TextEvent {
    text: string
    stream: number // 1 = stdout, 2 = stderr
}

/**
 * Represents a eval request to MATLAB
 */
export interface EvalRequest {
    requestId: string | number
    command: string
    isUserEval: boolean
    capabilitiesToRemove?: Capability[]
}

/**
 * Represents a eval response to MATLAB
 */
export interface EvalResponse {
    requestId: string | number
}

/**
 * Represents a feval request to MATLAB
 */
export interface FEvalRequest {
    requestId: string | number
    functionName: string
    nargout: number
    args: unknown[]
    capabilitiesToRemove?: Capability[]
}

/**
 * Represents a feval response from MATLAB
 */
export interface FEvalResponse {
    requestId: string | number
    result: unknown
}

/**
 * Represents a breakpoint request to MATLAB
 */
export interface BreakpointRequest {
    requestId: string | number
    fileName: string
    lineNumber: number
    condition?: string
    anonymousIndex?: number
}

/**
* Represents a breakpoint response from MATLAB
*/
export interface BreakpointResponse {
    requestId: string | number
    error?: MVMError
}

/**
 * MATLAB Error result
 */
export interface MVMError {
    error: unknown
}

export enum PromptState {
    INITIALIZING = 'INITIALIZING',
    READY = 'READY',
    BUSY = 'BUSY',
    DEBUG = 'DEBUG',
    INPUT = 'INPUT',
    PAUSE = 'PAUSE',
    MORE = 'MORE',
    COMPLETING_BLOCK = 'COMPLETING_BLOCK'
}
