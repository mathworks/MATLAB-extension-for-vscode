// Copyright 2026 The MathWorks, Inc.

import * as vscode from 'vscode'
import { DebugProtocol } from '@vscode/debugprotocol';
import { Disposable } from 'vscode';
import { MatlabMVMConnectionState, MVM } from '../commandwindow/MVM';

export default class BreakpointSynchronizer {
    private readonly _mvm: MVM;
    private _tracking: boolean = false;
    private _listeners: Disposable[] = [];
    private _timer: NodeJS.Timeout | null = null;
    private readonly _requestDispatcher: (request: DebugProtocol.Request) => void;

    private _forcedOff: boolean = true;

    private readonly _dirtyFiles: Set<string> = new Set();

    constructor (mvm: MVM, requestDispatcher: (request: DebugProtocol.Request) => void) {
        this._mvm = mvm;
        this._requestDispatcher = requestDispatcher;

        this._mvm.on(MVM.Events.stateChanged, (oldState, newState) => {
            if (this._forcedOff) {
                return;
            }

            if (newState !== MatlabMVMConnectionState.DISCONNECTED) {
                this._startTracking();
            } else {
                this._stopTracking();
            }
        });
    }

    disable (): void {
        this._forcedOff = true;
        this._stopTracking();
    }

    enable (): void {
        this._forcedOff = false;
        this._maybeStartTracking();
    }

    _maybeStartTracking (): void {
        if (this._mvm.getMatlabState() !== MatlabMVMConnectionState.DISCONNECTED) {
            this._startTracking();
        }
    }

    _startTracking (): void {
        if (this._tracking) {
            return;
        }

        this._tracking = true;

        this._listeners = [];

        this._listeners.push(vscode.debug.onDidChangeBreakpoints((event) => {
            event.added.filter((b) => b instanceof vscode.SourceBreakpoint).forEach((breakpoint) => {
                this._dirtyFiles.add(breakpoint.location.uri.fsPath);
            });
            event.changed.filter((b) => b instanceof vscode.SourceBreakpoint).forEach((breakpoint) => {
                this._dirtyFiles.add(breakpoint.location.uri.fsPath);
            });
            event.removed.filter((b) => b instanceof vscode.SourceBreakpoint).forEach((breakpoint) => {
                this._dirtyFiles.add(breakpoint.location.uri.fsPath);
            });
            this._triggerUpdate();
        }));

        this._listeners.push(vscode.workspace.onDidSaveTextDocument((event) => {
            if (this._dirtyFiles.has(event.uri.fsPath)) {
                this._triggerUpdate();
            }
        }));

        this._handleBreakpointsChanged(true);
    }

    _triggerUpdate (): void {
        if (this._timer == null) {
            this._timer = setTimeout(this._handleBreakpointsChanged.bind(this, false), 1000);
        }
    }

    /**
     * On breakpoint change, send relevant breakpoint update events to the server as though they were DAP events.
     * @param refreshAll
     */
    _handleBreakpointsChanged (refreshAll: boolean = true): void {
        this._timer = null;
        const breakpointRequests = {} as { [path: string]: DebugProtocol.SetBreakpointsRequest };

        const createSetBreakpointRequest = (path: string): DebugProtocol.SetBreakpointsRequest => ({
            arguments: {
                source: {
                    path: path
                },
                breakpoints: []
            },
            type: 'request',
            command: 'setBreakpoints',
            seq: 0
        });

        // Untitled and dirty files should not be included in the updates.
        const ignoredFiles = new Set();
        vscode.workspace.textDocuments.forEach((document) => {
            if (document.isDirty || document.isUntitled) {
                ignoredFiles.add(document.uri.fsPath);
            }
        });

        // Create empty breakpoint request for each file that we have had breakpoint change events for (and that are not ignored).
        const relevantDirtyFilePaths = Array.from(this._dirtyFiles.values()).filter((path) => !ignoredFiles.has(path));
        relevantDirtyFilePaths.forEach((path) => {
            breakpointRequests[path] = createSetBreakpointRequest(path);
        });

        // For each breakpoint in VS Code, optionally filter out based on whether we are doing a full refresh, or only sending changed breakpoints.
        vscode.debug.breakpoints.filter((b) => b instanceof vscode.SourceBreakpoint).filter((breakpoint) => {
            const path = breakpoint.location.uri.fsPath;
            if (refreshAll) {
                return true;
            } else {
                return this._dirtyFiles.has(path) && !ignoredFiles.has(path);
            }
        })
            .forEach((breakpoint) => {
            // For each breakpoint, update the request structure with the current data.
                const path = breakpoint.location.uri.fsPath;
                if (breakpointRequests[path] === undefined) {
                    breakpointRequests[path] = createSetBreakpointRequest(path);
                }
                breakpointRequests[path].arguments.breakpoints?.push({
                    line: breakpoint.location.range.start.line + 1,
                    condition: breakpoint.condition,
                    hitCondition: breakpoint.hitCondition,
                    logMessage: breakpoint.logMessage
                });
            });

        // Send each request object to the MATLAB Debug Adaptor
        Object.values(breakpointRequests).forEach((request) => {
            this._requestDispatcher(request);
        });

        // The remoev any handled files from the list of dirty files.
        relevantDirtyFilePaths.forEach((path) => {
            this._dirtyFiles.delete(path);
        });
    }

    _stopTracking (): void {
        this._tracking = false;
        this._dirtyFiles.clear();
        this._listeners.forEach((listener) => listener.dispose());
        this._listeners = [];
    }
}
