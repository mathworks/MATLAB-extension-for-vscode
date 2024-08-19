// Copyright 2022 - 2023 The MathWorks, Inc.

export default {
    MATLAB_CLOSED: {
        message: 'MATLAB has been closed. Some functionality might be unavailable.',
        options: ['Restart MATLAB']
    },
    MATLAB_LAUNCH_FAILED: {
        message: 'MATLAB was unable to start. If MATLAB is installed, confirm that the MATLAB executable path setting is properly configured.',
        options: ['Get MATLAB', 'Open settings', 'Do not show again']
    },
    FEATURE_UNAVAILABLE: {
        message: 'This feature is not available without MATLAB running.',
        options: ['Start MATLAB', 'Do not show again']
    },
    FEATURE_UNAVAILABLE_NO_MATLAB: {
        message: 'This feature is not available without MATLAB installed. If MATLAB is installed, confirm that the MATLAB executable path setting is properly configured.',
        options: ['Get MATLAB', 'Open settings', 'Do not show again']
    }
}
