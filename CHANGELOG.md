# Change Log

All notable changes to the "language-matlab" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
