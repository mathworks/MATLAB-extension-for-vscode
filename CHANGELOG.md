# Change Log

All notable changes to the "language-matlab" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
