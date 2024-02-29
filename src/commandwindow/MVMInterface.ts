// Copyright 2024 The MathWorks, Inc.

import { ResolvablePromise } from './Utilities';

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
}

/**
 * Represents a feval response to MATLAB
 */
export interface FEvalResponse {
    requestId: string | number
    result: unknown
}

/**
 * MATLAB Error result
 */
export interface FEvalError {
    error: unknown
}

/**
 * The base functionality for any MVM instance to support
 */
export default interface IMVM {
    eval: (command: string) => ResolvablePromise<void>
    feval: <T>(functionName: string, nargout: number, args: unknown[]) => ResolvablePromise<FEvalError | T>
    interrupt: () => void
    onOutput: (data: TextEvent) => void
    onClc: () => void
}
