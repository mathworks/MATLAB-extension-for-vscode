import * as vscode from 'vscode'
import { MVM, MatlabMVMConnectionState } from '../commandwindow/MVM'
import { MVMError } from '../commandwindow/MVMInterface'

interface VariableInfo {
    name: string
    size: string
    class: string
}

export default class WorkspaceVariableProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'matlab.workspaceVariables'

    private _view?: vscode.WebviewView
    private _variables: VariableInfo[] = []

    constructor (private readonly _mvm: MVM) {
        // Auto-refresh when MATLAB becomes idle after executing a command
        this._mvm.on(MVM.Events.promptChange, (state: string, isIdle: boolean) => {
            if (isIdle && this._mvm.getMatlabState() === MatlabMVMConnectionState.CONNECTED) {
                void this.refresh()
            }
        })

        // Refresh on connect, clear on disconnect
        this._mvm.on(MVM.Events.stateChanged, (_oldState: MatlabMVMConnectionState, newState: MatlabMVMConnectionState) => {
            if (newState === MatlabMVMConnectionState.DISCONNECTED) {
                this._variables = []
                this._updateWebview()
            } else if (newState === MatlabMVMConnectionState.CONNECTED) {
                void this.refresh()
            }
        })
    }

    resolveWebviewView (
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView

        webviewView.webview.options = {
            enableScripts: true
        }

        webviewView.webview.onDidReceiveMessage((message: { command: string, name?: string }) => {
            if (message.command === 'openvar' && message.name != null) {
                this._mvm.eval(`openvar('${message.name.replace(/'/g, "''")}')`, false)
            } else if (message.command === 'refresh') {
                void this.refresh()
            }
        })

        this._updateWebview()

        // If MATLAB is already connected, fetch variables immediately
        if (this._mvm.getMatlabState() === MatlabMVMConnectionState.CONNECTED) {
            void this.refresh()
        }
    }

    async refresh (): Promise<void> {
        if (this._mvm.getMatlabState() !== MatlabMVMConnectionState.CONNECTED) {
            this._variables = []
            this._updateWebview()
            return
        }

        try {
            // Use evalc to capture text output of whos from the base workspace.
            // Direct feval('whos') would run in its own function scope (empty),
            // and struct array serialization may not be supported by the MVM protocol.
            const result = await this._mvm.feval<string>('evalc', 1, ["evalin('base','whos')"], false)

            if (this._isError(result)) {
                this._variables = []
            } else {
                const text = result.result[0]
                if (typeof text === 'string') {
                    this._variables = this._parseWhosText(text)
                } else {
                    this._variables = []
                }
            }
        } catch {
            this._variables = []
        }

        this._updateWebview()
    }

    private _isError (result: unknown): result is MVMError {
        return result != null && typeof result === 'object' && 'error' in result
    }

    /**
     * Parse the text output of MATLAB's `whos` command.
     * Format:
     *   Name      Size            Bytes  Class     Attributes
     *   a         1x1                 8  double
     *   b         3x4                96  double
     */
    private _parseWhosText (text: string): VariableInfo[] {
        const lines = text.split('\n').map(l => l.trimEnd())
        const variables: VariableInfo[] = []

        // Find the header line to determine column positions
        const headerIdx = lines.findIndex(l => /^\s*Name\s+Size/i.test(l))
        if (headerIdx < 0) {
            return []
        }

        // Parse data lines after the header (skip blank lines)
        for (let i = headerIdx + 1; i < lines.length; i++) {
            const line = lines[i]
            if (line.trim() === '') {
                continue
            }
            // Each data line has: Name  Size  Bytes  Class  [Attributes]
            // Use whitespace splitting — names can't contain spaces
            const parts = line.trim().split(/\s+/)
            if (parts.length >= 4) {
                variables.push({
                    name: parts[0],
                    size: parts[1],
                    class: parts[3]
                })
            }
        }

        return variables
    }

    private _updateWebview (): void {
        if (this._view == null) {
            return
        }
        this._view.webview.html = this._getHtml()
    }

    private _getHtml (): string {
        const isConnected = this._mvm.getMatlabState() === MatlabMVMConnectionState.CONNECTED

        const rows = this._variables.map(v => {
            return `<tr>
                <td class="name-cell" data-name="${this._escapeHtml(v.name)}">${this._escapeHtml(v.name)}</td>
                <td>${this._escapeHtml(v.size)}</td>
                <td>${this._escapeHtml(v.class)}</td>
            </tr>`
        }).join('')

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    body {
        padding: 0;
        margin: 0;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
    }
    .toolbar {
        display: flex;
        align-items: center;
        padding: 4px 8px;
        gap: 4px;
    }
    .toolbar button {
        background: none;
        border: none;
        color: var(--vscode-foreground);
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 14px;
    }
    .toolbar button:hover {
        background: var(--vscode-toolbar-hoverBackground);
    }
    .status {
        font-size: 11px;
        opacity: 0.7;
        margin-left: auto;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
    }
    th {
        text-align: left;
        padding: 4px 8px;
        border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, #444));
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        opacity: 0.8;
        position: sticky;
        top: 0;
        background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }
    th:nth-child(1) { width: 45%; }
    th:nth-child(2) { width: 25%; }
    th:nth-child(3) { width: 30%; }
    td {
        padding: 3px 8px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    tr:hover td {
        background: var(--vscode-list-hoverBackground);
    }
    .name-cell {
        cursor: pointer;
        color: var(--vscode-textLink-foreground);
    }
    .name-cell:hover {
        text-decoration: underline;
    }
    .empty-state {
        text-align: center;
        padding: 20px 10px;
        opacity: 0.6;
        font-size: 12px;
    }
</style>
</head>
<body>
    <div class="toolbar">
        <button onclick="refresh()" title="Refresh">&#x21bb;</button>
        <span class="status">${isConnected ? this._variables.length + ' variable' + (this._variables.length !== 1 ? 's' : '') : 'Not connected'}</span>
    </div>
    ${this._variables.length > 0
        ? `<table>
            <thead><tr><th>Name</th><th>Size</th><th>Class</th></tr></thead>
            <tbody>${rows}</tbody>
           </table>`
        : `<div class="empty-state">${isConnected ? 'No variables in workspace' : 'Connect to MATLAB to view workspace variables'}</div>`
    }
    <script>
        const vscode = acquireVsCodeApi();
        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }
        document.addEventListener('click', (e) => {
            const cell = e.target.closest('.name-cell');
            if (cell) {
                vscode.postMessage({ command: 'openvar', name: cell.dataset.name });
            }
        });
    </script>
</body>
</html>`
    }

    private _escapeHtml (text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
    }
}
