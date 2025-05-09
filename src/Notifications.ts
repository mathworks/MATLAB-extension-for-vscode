// Copyright 2023-2025 The MathWorks, Inc.

enum Notification {
    // Connection Status Updates
    MatlabConnectionClientUpdate = 'matlab/connection/update/client',
    MatlabConnectionServerUpdate = 'matlab/connection/update/server',

    // Errors
    MatlabLaunchFailed = 'matlab/launchfailed',
    MatlabFeatureUnavailable = 'feature/needsmatlab',
    MatlabFeatureUnavailableNoMatlab = 'feature/needsmatlab/nomatlab',

    // MATLAB Version Deprecation
    MatlabVersionDeprecation = 'matlab/version/deprecation',

    // Execution
    MatlabRequestInstance = 'matlab/request',
    TerminalCompletionRequest = 'TerminalCompletionRequest',
    TerminalCompletionResponse = 'TerminalCompletionResponse',

    MVMEvalRequest = 'evalRequest',
    MVMEvalComplete = 'evalResponse',
    MVMFevalRequest = 'fevalRequest',
    MVMFevalComplete = 'fevalResponse',
    MVMSetBreakpointRequest = 'setBreakpointRequest',
    MVMSetBreakpointComplete = 'setBreakpointResponse',
    MVMClearBreakpointRequest = 'clearBreakpointRequest',
    MVMClearBreakpointComplete = 'clearBreakpointResponse',

    MVMText = 'text',
    MVMClc = 'clc',
    MVMPromptChange = 'mvmPromptChange',

    MVMInterruptRequest = 'interruptRequest',
    MVMUnpauseRequest = 'unpauseRequest',

    MVMStateChange = 'mvmStateChange',

    DebuggingStateChange = 'DebuggingStateChange',
    DebugAdaptorRequest = 'DebugAdaptorRequest',
    DebugAdaptorResponse = 'DebugAdaptorResponse',
    DebugAdaptorEvent = 'DebugAdaptorEvent',

    // Telemetry
    LogTelemetryData = 'telemetry/logdata',

    // Sections generated for Section Styling
    MatlabSections = 'matlab/sections',

    // Licensing
    LicensingServerUrl = 'licensing/server/url',
    LicensingData = 'licensing/data',
    LicensingDelete = 'licensing/delete',
    LicensingError = 'licensing/error'
}

export default Notification
