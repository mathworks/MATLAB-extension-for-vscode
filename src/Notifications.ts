// Copyright 2023-2024 The MathWorks, Inc.

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

    MVMEvalRequest = 'evalRequest',
    MVMEvalComplete = 'evalRequest',
    MVMFevalRequest = 'fevalRequest',
    MVMFevalComplete = 'fevalRequest',

    MVMText = 'text',
    MVMClc = 'clc',

    MVMInterruptRequest = 'interruptRequest',

    MVMStateChange = 'mvmStateChange',

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
