// Copyright 2024-2025 The MathWorks, Inc.

import * as vscode from 'vscode'
import { MVM } from './MVM'
import TerminalService from './TerminalService'
import TelemetryLogger from '../telemetry/TelemetryLogger'
import * as path from 'path'
import { SectionModel } from '../model/SectionModel'
import { Capability } from './MVMInterface'

// These values must match the results returned by mdbfileonpath.m in FilePathState.m
enum FILE_PATH_STATE {
    FILE_NOT_ON_PATH = 0,
    FILE_WILL_RUN = 1,
    FILE_SHADOWED_BY_PWD = 2,
    FILE_SHADOWED_BY_TBX = 3,
    FILE_SHADOWED_BY_PFILE = 4,
    FILE_SHADOWED_BY_MEXFILE = 5,
    FILE_SHADOWED_BY_MLXFILE = 6,
    FILE_SHADOWED_BY_MLAPPFILE = 7
}

export default class ExecutionCommandProvider {
    private readonly _mvm: MVM;
    private readonly _terminalService: TerminalService;
    private readonly _telemetryLogger: TelemetryLogger;

    constructor (mvm: MVM, terminalService: TerminalService, telemetryLogger: TelemetryLogger) {
        this._mvm = mvm;
        this._terminalService = terminalService;
        this._telemetryLogger = telemetryLogger;
    }

    /**
     * Handle the run file action
     * @returns
     */
    async handleRunFile (): Promise<void> {
        const editor = vscode.window.activeTextEditor

        this._telemetryLogger.logEvent({
            eventKey: 'ML_VS_CODE_ACTIONS',
            data: {
                action_type: 'runFile',
                result: ''
            }
        });

        // Early return if the editor isn't valid or isn't MATLAB
        if (editor === undefined || editor.document.languageId !== 'matlab') {
            return;
        }

        // Open the terminal and wait for the MVM to be started.
        // This could take a while, so should double check the editor state after this point.
        await this._terminalService.openTerminalOrBringToFront();
        try {
            await this._mvm.getReadyPromise();
        } catch (e) {
            return;
        }

        // If the editor has been closed or is untitled, return
        if (editor.document.isClosed || editor.document.isUntitled) {
            return;
        }

        // If the editor is dirty, or an untitled document, the save it and notify MATLAB of the change.
        if (editor.document.isDirty) {
            try {
                await editor.document.save();
                const filePath = editor.document.fileName;
                await this._mvm.feval('fschange', 0, [filePath]);
                await this._mvm.feval('clear', 0, [filePath]);
            } catch (e) {
                return;
            }
        }

        if (editor.document.isUntitled) {
            return;
        }

        const filePath = editor.document.fileName;
        const fileParts = filePath.split(path.sep);
        const filenameWithExtension = fileParts[fileParts.length - 1];

        // Verify that this is an m file.
        if (!filenameWithExtension.endsWith('.m')) {
            return;
        }

        // Extract the command to run the file. That is, the default run configuration.
        const filenameWithoutExtension = filenameWithExtension.substring(0, filenameWithExtension.length - 2)

        let commandToRun = filenameWithoutExtension;

        // Handle the case where the file is in a class folder
        let parentIndex = fileParts.length - 2;
        const parentFolder = fileParts[parentIndex]
        if (parentFolder.startsWith('@')) {
            commandToRun = parentFolder.substring(1) + '.' + commandToRun;
            parentIndex--;
        }

        // Handle MATLAB namespaces by prepending the folder names until the first "+" folder.
        while (parentIndex >= 0) {
            const parentFolder = fileParts[parentIndex]
            if (!parentFolder.startsWith('+')) {
                break;
            }

            commandToRun = parentFolder.substring(1) + '.' + commandToRun;
            parentIndex--;
        }

        // Check whether the file is runnable, shadowed, etc.
        let mdbfileonpathResult;
        try {
            /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
            mdbfileonpathResult = await this._mvm.feval<any>('mdbfileonpath', 2, [filePath]);
        } catch (e) {
            return;
        }

        if ('error' in mdbfileonpathResult) {
            return;
        }

        const status = mdbfileonpathResult.result[1] as FILE_PATH_STATE;

        // Handle the results of the path check
        try {
            switch (status) {
                case FILE_PATH_STATE.FILE_WILL_RUN:
                    this._terminalService.getCommandWindow().insertCommandForEval(commandToRun);
                    break;
                case FILE_PATH_STATE.FILE_NOT_ON_PATH:
                case FILE_PATH_STATE.FILE_SHADOWED_BY_TBX:
                    await this._handleNotOnPath(filePath, commandToRun);
                    break;
                case FILE_PATH_STATE.FILE_SHADOWED_BY_PWD:
                    await this._handleShadowedByPwd(filePath, commandToRun);
                    break;
                default:
                    void vscode.window.showErrorMessage('Unable to run file as it is shadowed by another file in the same folder.');
            }
        } catch (e) {

        }
    }

    /**
     *
     * @param fileParts
     * @param commandToRun
     * @returns
     */
    private async _handleNotOnPath (filePath: string, commandToRun: string): Promise<void> {
        const choice = await vscode.window.showWarningMessage('File is not found in the current folder or on the MATLAB path.', 'Add to Path', 'Change Folder', 'Cancel');
        if (choice === undefined || choice === 'Cancel') {
            return;
        }

        const filePathWithoutFilename = path.dirname(filePath);
        if (choice === 'Add to Path') {
            await this._mvm.feval('addpath', 0, [filePathWithoutFilename]);
        } else {
            await this._mvm.feval('cd', 0, [filePathWithoutFilename]);
        }
        await this._terminalService.openTerminalOrBringToFront();
        this._terminalService.getCommandWindow().insertCommandForEval(commandToRun);
    }

    private async _handleShadowedByPwd (filePath: string, commandToRun: string): Promise<void> {
        const choice = await vscode.window.showWarningMessage('File is shadowed by another file in the current folder.', 'Change Folder', 'Cancel');
        if (choice === undefined || choice === 'Cancel') {
            return;
        }
        const filePathWithoutFilename = path.dirname(filePath);
        await this._mvm.feval('cd', 0, [filePathWithoutFilename]);
        await this._terminalService.openTerminalOrBringToFront();
        this._terminalService.getCommandWindow().insertCommandForEval(commandToRun);
    }

    async handleRunSection (sectionModel: SectionModel): Promise<void> {
        this._telemetryLogger.logEvent({
            eventKey: 'ML_VS_CODE_ACTIONS',
            data: {
                action_type: 'runSection',
                result: ''
            }
        });

        const editor = vscode.window.activeTextEditor
        if (editor === undefined || editor.document.languageId !== 'matlab') {
            return;
        }

        const sectionData = sectionModel.getSectionsForFile(editor.document.uri);

        if (sectionData === undefined) {
            return;
        }

        sectionData.isDirty = sectionData.isDirty ?? true;

        if (sectionData.isDirty || sectionData.sectionsTree === undefined) {
            return;
        }

        const fileName = path.basename(editor.document.fileName);
        const filePath = editor.document.isUntitled ? fileName : path.basename(editor.document.fileName);
        const text = editor.document.getText();
        const lineRange = sectionData.sectionsTree.find(editor.selection.active.line)?.range;
        const sectionLineRanges = sectionData.sectionRanges.map((section) => [section.range.start.line + 1, section.range.end.line + 1]);

        if (lineRange === undefined) {
            return;
        }

        await this._terminalService.openTerminalOrBringToFront();
        try {
            await this._mvm.getReadyPromise();
        } catch (e) {
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let args: any[];

        switch (this._mvm.getMatlabRelease()) {
            case undefined:
            case 'R2021b':
            case 'R2022a':
            case 'R2022b':
            case 'R2023a': {
                const splitLines = text.split(/\r\n|\r|\n/);
                const startPosition = splitLines.slice(0, lineRange.start.line).join('\n').length + 1;
                const executionLength = splitLines.slice(lineRange.start.line, lineRange.end.line + 1).join('\n').length + 1;

                args = [
                    fileName,
                    filePath,
                    text,
                    startPosition,
                    executionLength,
                    -1,
                    'vscode',
                    '',
                    false,
                    false
                ];
                break;
            }
            default:
                args = [
                    fileName,
                    filePath,
                    text,
                    lineRange.start.line + 1,
                    lineRange.end.line + 1,
                    -1,
                    'vscode',
                    '',
                    false,
                    false,
                    sectionLineRanges
                ];
                break;
        }

        void this._mvm.feval('matlab.internal.editor.evaluateCode', 0, args, true, [
            Capability.Debugging
        ]);
    }

    /**
     * Implements the run selection action
     * @returns
     */
    async handleRunSelection (): Promise<void> {
        this._telemetryLogger.logEvent({
            eventKey: 'ML_VS_CODE_ACTIONS',
            data: {
                action_type: 'runSelection',
                result: ''
            }
        });

        const editor = vscode.window.activeTextEditor
        if (editor === undefined || editor.document.languageId !== 'matlab') {
            return;
        }

        const text = editor.document.getText(editor.selection);

        await this._terminalService.openTerminalOrBringToFront();
        try {
            await this._mvm.getReadyPromise();
        } catch (e) {
            return;
        }

        this._terminalService.getCommandWindow().insertCommandForEval(text);
    }

    /**
     * Implements the interrupt action
     */
    handleInterrupt (): void {
        this._telemetryLogger.logEvent({
            eventKey: 'ML_VS_CODE_ACTIONS',
            data: {
                action_type: 'interrupt',
                result: ''
            }
        });
        this._mvm.interrupt();
    }

    /**
     * Implements the add to path action
     * @param uri The file path that should be added to the MATLAB path
     * @returns
     */
    async handleAddFolderToPath (uri: vscode.Uri): Promise<void> {
        this._telemetryLogger.logEvent({
            eventKey: 'ML_VS_CODE_ACTIONS',
            data: {
                action_type: 'addToPath',
                result: ''
            }
        });

        await this._terminalService.openTerminalOrBringToFront();

        try {
            await this._mvm.getReadyPromise();
        } catch (e) {
            return;
        }

        void this._mvm.feval('addpath', 0, [uri.fsPath]);
    }

    async handleAddFolderAndSubfoldersToPath (uri: vscode.Uri): Promise<void> {
        this._telemetryLogger.logEvent({
            eventKey: 'ML_VS_CODE_ACTIONS',
            data: {
                action_type: 'addFolderAndSubfoldersToPath',
                result: ''
            }
        });

        await this._terminalService.openTerminalOrBringToFront();

        try {
            await this._mvm.getReadyPromise();
        } catch (e) {
            return;
        }

        // Escape any single quotes in the folder's path
        const escapedPath = uri.fsPath.replace(/'/g, "''");

        const command = `addpath(genpath('${escapedPath}'))`;
        void this._mvm.eval(command);
    }

    /**
     * Implements the MATLAB change directory action
     * @param uri The file path that MATLAB should "cd" to
     * @returns
     */
    async handleChangeDirectory (uri: vscode.Uri): Promise<void> {
        this._telemetryLogger.logEvent({
            eventKey: 'ML_VS_CODE_ACTIONS',
            data: {
                action_type: 'changeDirectory',
                result: ''
            }
        });

        await this._terminalService.openTerminalOrBringToFront();

        try {
            await this._mvm.getReadyPromise();
        } catch (e) {
            return;
        }

        void this._mvm.feval('cd', 0, [uri.fsPath]);
    }

    /**
     * Implements the open file action
     * @param uri The file path to the file that should be opened
     * @returns
     */
    async handleOpenFile (uri: vscode.Uri): Promise<void> {
        this._telemetryLogger.logEvent({
            eventKey: 'ML_VS_CODE_ACTIONS',
            data: {
                action_type: 'openFile',
                result: ''
            }
        });

        await this._terminalService.openTerminalOrBringToFront();

        try {
            await this._mvm.getReadyPromise();
        } catch (e) {
            return;
        }

        void this._mvm.feval('open', 0, [uri.fsPath]);
    }
}
