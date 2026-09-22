// Copyright 2026 The MathWorks, Inc.

import BaseService from '../services/BaseService'
import { Notifier } from '../commandwindow/MultiClientNotifier'
import Notification from '../notifications/Notifications'
import { VVClientRequest, VVServerResponse } from './types'

type ResponseListener = (response: VVServerResponse) => void

/**
 * Bridges Variable Viewer communication between the extension and the MATLAB language server.
 * Sends typed requests via VVClientMessage and routes incoming VVServerMessage responses
 * to the registered listener (typically the VariableViewerPanelManager).
 */
export default class VariableViewerService extends BaseService {
    private listener: ResponseListener | undefined

    /** @param notifier - The notification transport for sending/receiving language server messages. */
    constructor (
        private readonly notifier: Notifier
    ) {
        super()

        this.own(
            notifier.onNotification(Notification.VVServerMessage, (msg: Record<string, unknown>) => {
                this.onServerMessage(msg as unknown as VVServerResponse)
            })
        )
    }

    /**
     * Sends a typed request to the MATLAB language server.
     * @param request - The request to send (query variable, query page, or open variable).
     */
    sendRequest (request: VVClientRequest): void {
        this.notifier.sendNotification(Notification.VVClientMessage, request)
    }

    /**
     * Registers the callback that receives all server responses.
     * @param listener - The function to invoke for each incoming server message.
     */
    setResponseListener (listener: ResponseListener): void {
        this.listener = listener
    }

    // ── Server Message Handling ──────────────────────────────────────

    /**
     * Forwards a received server message to the registered listener.
     * @param msg - The parsed server response.
     */
    private onServerMessage (msg: VVServerResponse): void {
        this.listener?.(msg)
    }
}
