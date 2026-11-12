// Copyright 2024-2026 The MathWorks, Inc.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsPromise from 'fs/promises';
import * as path from 'path';

import * as vscodeTextmate from 'vscode-textmate';
import * as oniguruma from 'vscode-oniguruma';

import { CommandWindowHost, LineToken, LineTokenizer } from './CommandWindowHost';

/* eslint-disable @typescript-eslint/strict-boolean-expressions */

/**
 * Provides the command window with VS Code's clipboard, context keys, commands, and theme.
 */
export default class DefaultCommandWindowHost implements CommandWindowHost {
    constructor (private readonly _context: vscode.ExtensionContext) {}

    writeClipboard (text: string): void {
        void vscode.env.clipboard.writeText(text);
    }

    async readClipboard (): Promise<string> {
        return await vscode.env.clipboard.readText();
    }

    setHasSelection (hasSelection: boolean): void {
        void vscode.commands.executeCommand('setContext', 'matlab.terminalHasSelection', hasSelection);
    }

    revealCommandWindow (): void {
        void vscode.commands.executeCommand('matlab.openCommandWindow');
    }

    async createTokenizer (): Promise<LineTokenizer | undefined> {
        return await DefaultLineTokenizer.create(this._context);
    }
}

const enum EncodedTokenDataConsts {
    FOREGROUND_MASK = 0b00000000111111111000000000000000,
    FOREGROUND_OFFSET = 15
}

class DefaultLineTokenizer implements LineTokenizer, vscode.Disposable {
    private constructor (
        private readonly _grammar: vscodeTextmate.IGrammar,
        private readonly _registry: vscodeTextmate.Registry,
        private readonly _themeListener: vscode.Disposable
    ) {}

    /**
     * Initialize the textmate tokenizer. This is the same as what the VS Code Editor uses and should guarentee identical results.
     */
    static async create (context: vscode.ExtensionContext): Promise<DefaultLineTokenizer | undefined> {
        // Load the oniguruma regex library used by the tokenizer.
        const wasmBin = fs.readFileSync(context.asAbsolutePath('node_modules/vscode-oniguruma/release/onig.wasm')).buffer;

        const vscodeOnigurumaLib = oniguruma.loadWASM(wasmBin as any).then(() => {
            return {
                createOnigScanner (patterns: any) { return new oniguruma.OnigScanner(patterns); },
                createOnigString (s: any) { return new oniguruma.OnigString(s); }
            };
        });

        const themeName = vscode.workspace.getConfiguration('workbench').get('colorTheme') as string;

        // Create a registry that can create a grammar from a scope name, providing it the MATLAB syntax file and the current theme.
        const registry = new vscodeTextmate.Registry({
            theme: processTheme(themeName),
            onigLib: vscodeOnigurumaLib,
            loadGrammar: async () => {
                const languageFile = await fsPromise.readFile(context.asAbsolutePath('syntaxes/Matlab.tmbundle/Syntaxes/MATLAB.tmLanguage'));
                return vscodeTextmate.parseRawGrammar(languageFile.toString());
            }
        });

        // Handle theme changes by reprocessing the new theme
        const themeListener = vscode.window.onDidChangeActiveColorTheme(() => {
            const themeName = vscode.workspace.getConfiguration('workbench').get('colorTheme') as string;
            registry.setTheme(processTheme(themeName));
        });

        // Load the MATLAB grammar
        const grammar = await registry.loadGrammar('source.matlab');
        if (grammar == null) {
            themeListener.dispose();
            registry.dispose();
            return undefined;
        }
        return new DefaultLineTokenizer(grammar, registry, themeListener);
    }

    tokenizeLine (line: string): LineToken[] {
        // The tokenizeLine2 call returns the result in binary format containing,
        // among other data, the start and end indices and foreground color to use based on the current theme
        const tokens = this._grammar.tokenizeLine2(line, vscodeTextmate.INITIAL).tokens;
        const colorMap = this._registry.getColorMap();
        const result: LineToken[] = [];
        for (let j = 0; j < tokens.length / 2; j++) {
            const tokenMetaData = tokens[2 * j + 1];
            const foregroundId = ((tokenMetaData & EncodedTokenDataConsts.FOREGROUND_MASK) >>> EncodedTokenDataConsts.FOREGROUND_OFFSET);
            result.push({ startIndex: tokens[2 * j], color: colorMap[foregroundId] });
        }
        return result;
    }

    dispose (): void {
        this._themeListener.dispose();
        this._registry.dispose();
    }
}

/**
 * Convert the current VS Code theme into a form that can be used by the textmate tokenizer.
 */
function processTheme (themeName: string): vscodeTextmate.IRawTheme {
    const theme: vscodeTextmate.IRawTheme = {
        name: themeName,
        settings: []
    };

    // Find the given theme extension.
    let currentThemePath;
    for (const extension of vscode.extensions.all) {
        const themes = extension.packageJSON.contributes?.themes;
        const currentTheme = themes?.find((theme: any) => theme.label === themeName || theme.id === themeName);
        if (currentTheme) {
            currentThemePath = path.join(extension.extensionPath, currentTheme.path);
            break;
        }
    }

    // Load the theme and all recursively included themes.
    const themePaths = [];
    const themeFiles = [];
    if (currentThemePath) {
        themePaths.push(currentThemePath);
    }
    while (themePaths.length > 0) {
        const themePath: string = themePaths.pop()!;

        let themeData: any;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            themeData = require(themePath);
        } catch (err) {
            console.log('Error while loading and parsing theme file: ', themePath, err);
            // Return the still empty theme in the case of an error.
            return theme;
        }

        if (themeData !== undefined) {
            themeFiles.push(themeData);
            if (themeData.include) {
                themePaths.push(path.join(path.dirname(themePath), themeData.include));
            }
        }
    }

    // Create the data structure that maps from textmate paths to colors.
    while (themeFiles.length > 0) {
        const themeData = themeFiles.pop();
        if (themeData.tokenColors) {
            theme.settings.push(...themeData.tokenColors);
        }
    }

    // Manually add parentheses, brackets, and braces to the theme, because this is usually handled by bracket matching, not syntax highlighting.
    theme.settings.push({ scope: ['punctuation.section.parens', 'punctuation.section.brackets', 'punctuation.section.braces'], settings: { foreground: '#FFD703' } });

    return theme;
}
