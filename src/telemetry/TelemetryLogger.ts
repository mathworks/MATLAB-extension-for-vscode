// Copyright 2023-2024 The MathWorks, Inc.

import fetch from 'node-fetch'
import { env, workspace } from 'vscode'

const PRODUCT = 'ML_VS_CODE'
const APPLICATION_NAME = 'MATLAB_EXTENSION_FOR_VSCODE'
const APPLICATION_KEY = 'OWY3N2FkZTMtYWU1My00MjU3LThjZTktMzFmMTAyYjM0Njc5'

const ENDPOINT = 'https://udc-service.mathworks.com/udc/service/v1/events'

export interface TelemetryEvent {
    eventKey: string
    data: unknown
}

export default class TelemetryLogger {
    constructor (private readonly extensionVersion: string) {}

    logEvent (event: TelemetryEvent): void {
        if (this.shouldLogTelemetry(event)) {
            this.sendEvent(event)
        }
    }

    private shouldLogTelemetry (event: TelemetryEvent): boolean {
        if (!env.isTelemetryEnabled) {
            // Never log when VS Code's general telemetry is disabled
            console.log('Logging DDUX')
            return false
        }

        if (event.eventKey === 'ML_VS_CODE_SETTING_CHANGE') {
            // Do log when the `matlab.telemetry` setting changes
            return (event.data as { setting_name: string }).setting_name === 'telemetry'
        }

        // Otherwise, adhere to the `matlab.telemetry` setting
        const configuration = workspace.getConfiguration('MATLAB')
        return configuration.get<boolean>('telemetry') ?? true
    }

    private sendEvent (event: TelemetryEvent): void {
        const eventData = {
            logDDUXData: {
                product: PRODUCT,
                keyValues: event.data
            }
        }

        const eventDataString = JSON.stringify(eventData)
        const eventEntry = {
            sessionKey: env.sessionId,
            eventKey: event.eventKey,
            eventDate: this.getCurrentDateString(),
            eventData: eventDataString
        }

        const message = {
            Event: [eventEntry]
        }

        fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-mw-udc-client-version': '1.0',
                'x-mw-udc-application-name': APPLICATION_NAME,
                'x-mw-udc-application-version': this.extensionVersion,
                'x-mw-authentication': Buffer.from(APPLICATION_KEY, 'base64').toString()
            },
            body: JSON.stringify(message)
        }).then(response => {
            if (!response.ok) {
                console.error(`Telemetry post failed, code = ${response.status} (${response.statusText})`)
            }
        }).catch(error => {
            console.error('Telemetry post error: ', error)
        })
    }

    private getCurrentDateString (): string {
        return new Date().toISOString().slice(0, 23) // Slice off trailing 'Z'
    }
}
