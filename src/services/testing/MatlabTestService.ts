// Copyright 2026 The MathWorks, Inc.

import * as vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node'

import BaseService from '../BaseService'
import { MVM } from '../../commandwindow/MVM'
import TelemetryLogger from '../telemetry/TelemetryLogger'
import MatlabTestDiscovery from './MatlabTestDiscovery'
import MatlabTestRunner from './MatlabTestRunner'

export default class MatlabTestService extends BaseService {
    private readonly controller: vscode.TestController
    private readonly discovery: MatlabTestDiscovery
    private readonly runner: MatlabTestRunner

    constructor (
        private readonly client: LanguageClient,
        private readonly mvm: MVM,
        private readonly telemetryLogger: TelemetryLogger,
        private readonly context: vscode.ExtensionContext
    ) {
        super()

        this.controller = vscode.tests.createTestController('matlab-tests', 'MATLAB Tests')
        this.own(this.controller)

        void vscode.commands.executeCommand('setContext', 'matlab.testing.isActive', true)

        this.discovery = new MatlabTestDiscovery(this.controller, this.mvm, this.context, this.telemetryLogger)
        this.own(this.discovery)

        this.runner = new MatlabTestRunner(this.controller, this.client, this.mvm, this.telemetryLogger)
        this.own(this.runner)

        this.own(
            vscode.commands.registerCommand('matlab.testing.runAllTests', () => this.handleRunAllTests()),
            vscode.commands.registerCommand('matlab.testing.discoverTests', () => this.discovery.discoverAll()),
            vscode.commands.registerCommand('matlab.testing.addTestFolder', () => this.discovery.addTestFolder()),
            vscode.commands.registerCommand('matlab.testing.addTestFile', () => this.discovery.addTestFile()),
            vscode.commands.registerCommand('matlab.testing.removeTestItem', (item: vscode.TestItem) => this.discovery.removeTestItem(item))
        )
    }

    private handleRunAllTests (): void {
        this.runner.runAll()
    }
}
