# Change Log

All notable changes to the "language-matlab" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.3] - 2025-05-15

### Added
- Use automatic code completion to complete commands in the MATLAB terminal
- Move the cursor in the MATLAB terminal using `Alt+Click`
- Support for debugging P-coded files when the corresponding source file is available
- Filter the commands in the MATLAB terminal history by entering text in the terminal (Thanks @robertoffmoura!)

### Fixed
- Resolves issues with the MATLAB workspace not updating correctly when switching contexts in the call stack
- Resolves potential crashes when using code completion in files without a .m file extension
- Patches CVE-2024-12905

## [1.3.2] - 2025-03-06

### Fixed
- Resolves errors with adding workspace folders to the MATLAB path on macOS and Linux systems
- Update keyboard shortcut to stop MATLAB execution from `Cmd+C` to `Ctrl+C` on macOS systems

## [1.3.1] - 2025-01-23

### Added
- The extension keeps the MATLAB path in sync with the VS Code workspace, improving code navigation, completions, and execution
- The extension keeps the MATLAB debug workspace in sync with the selected callstack in VS Code

### Fixed
- Changing the default value of `MATLAB.startDebuggerAutomatically` to `false`
- Resolves errors with document formatting when using with MATLAB R2025a
- Resolves errors with execution and debugging when using with MATLAB R2022a

## [1.3.0] - 2024-12-18

### Notice
- This extension no longer supports MATLAB R2021a. To make use of the advanced features of the extension or run and debug MATLAB code, you must have MATLAB R2021b or later installed.

### Added
- Debugging support
- Support for inserting code snippets shipped with MATLAB (requires MATLAB R2025a or later)
- Support for opening additional MATLAB file types (e.g. `.slx`, `.fig`) from the Visual Studio Code context menu (Community contribution from @Gusmano-2-OSU)

### Fixed
- Syntax highlighting improvements (Community contribution from @apozharski)
- Patches CVE-2024-21538, CVE-2024-52798, and CVE-2024-55565

## [1.2.7] - 2024-11-07

### Added
- Visual indication of code sections
- Enable browser-based sign in using the `signIn` setting
- Specify the maximum file size for code analysis using the new `maxFileSizeForAnalysis` setting
- Linting support in untitled files and in MATLAB files with different file extensions

### Fixed
- The `installPath` setting no longer syncs between machines

## [1.2.6] - 2024-09-20

### Fixed
- Patches CVE-2024-4067 and CVE-2024-43788
- Resolves issue preventing code navigation and variable renaming for variables followed by a matrix operation (e.g. `x.^2`)
- Improves syntax highlighting in MATLAB class definitions

## [1.2.5] - 2024-08-16

### Added
- Symbol rename support
- Enable hiding "feature not available" error popups
- Provides context menu option to add selected folder and subfolders to the path

### Fixed
- Leading or trailing whitespace in `installPath` setting is ignored when connecting to MATLAB

## [1.2.4] - 2024-07-12

### Added
- Enable specifying workspace-specific MATLAB install paths
- Improvements to code folding (requires MATLAB R2024b or later)

### Fixed
- Patches CVE-2024-37890
- Allow connection to MATLAB when a single quote appears in the extension installation path
- Resolve error with code navigation when using with MATLAB R2024b
- Various syntax highlighting improvements (Thanks @watermarkhu!)

## [1.2.3] - 2024-06-14

### Notice
- This extension will no longer support MATLAB R2021a in a future release. To make use of the advanced features of the extension or run MATLAB code, you will need to have MATLAB R2021b or later installed.

### Added
- Popups will be shown to inform when the connected MATLAB is not supported by the extension, or if support is planned to be removed in a future update.

### Fixed
- Resolved issue with connecting to Intel MATLAB installation on Apple Silicon machines
- Resolved error if MATLAB process is killed unexpectedly
- Fixed bug where "never" startup timing was ignored

## [1.2.2] - 2024-05-17

### Changed
- Tweaks to telemetry logging

### Fixed
- Resolved packaging failure on Mac
- Resolved connecting to MATLAB in proxy environment

## [1.2.1] - 2024-04-04

### Added
- Extension now works with the New Desktop for MATLAB

### Fixed
- Fixed launching App Designer and Simulink through MATLAB code execution

## [1.2.0] - 2024-03-05

### Added
- Code execution support

### Fixed
- Fixed linting diagnostic suppression with MATLAB R2024a

## [1.1.6] - 2024-01-16

### Fixed
- Enabled language server features in untitled MATLAB files
- Fixed linting with mlint on Windows
- Fixed regression with code navigation when using with MATLAB R2024a

## [1.1.5] - 2023-12-06

### Fixed
- Fixed code navigation when using with MATLAB R2024a
- Handle symbolic link to MATLAB when linting with mlint (Thanks @MoetaYuko!)
- Handle maca64 architecture when linting with mlint (Thanks @tiagovla!)

## [1.1.4] - 2023-10-16

### Added
- Outline now includes section headers

## [1.1.3] - 2023-09-13

### Fixed
- Fixed issue connecting to MATLAB with Visual Studio Code version 1.82 and later

## [1.1.2] - 2023-08-14

### Fixed

- Patched CVE-2023-26136 and CVE-2022-25883
- Added missing file icon for MATLAB files

## [1.1.1] - 2023-07-10

### Fixed

- Diagnostic suppression should be placed at correct location when '%' is contained within string
- Improved navigation to files inside MATLAB packages within the VS Code workspace but not on the MATLAB path
- Prevented navigation to private/local functions from other files
- MATLAB sign-in is no longer blocked on Windows

## [1.1.0] - 2023-06-05

### Added
- Document symbol and outline support

### Fixed

- Prevent packaging of .github folder into extension
- Code folding no longer matches `end` when used in strings, comments, and to denote the end of a matrix

## [1.0.2] - 2023-05-05

### Fixed

- Update `vsce` to to `@vscode/vsce` to resolve [CVE-2023-0842](https://nvd.nist.gov/vuln/detail/CVE-2023-0842)

## [1.0.1] - 2023-04-27

### Changed

- Updated display name from "MATLAB (MathWorks)" to "MATLAB"

## [1.0.0] - 2023-04-26

- Initial Release

### Added

- Syntax Highlighting (via [MATLAB Language grammar](https://github.com/mathworks/MATLAB-Language-grammar))
- Snippets
- Other language support features (via [MATLAB language server](https://github.com/mathworks/MATLAB-language-server))
