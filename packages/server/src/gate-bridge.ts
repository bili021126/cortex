/**
 * @cortex/server — RemoteGateBridge
 *
 * Implements PlatformBridge for remote (WebSocket) confirmation.
 * Broadcasts gate.request events and waits for gate.resolve commands.
 */

import {
  PlatformKind,
  type ConfirmationRequest,
  type ConfirmationResponse,
  type PlatformBridge,
  type PlatformContext,
} from "@cortex/shared";
import type { WSGateRequestEvent, WSGateNotifyEvent } from "@cortex/protocol";

/** Broadcast function signature */
export type BroadcastFn = (channel: string, data: unknown) => void;

/** Pending confirmation entry */
interface PendingConfirmation {
  resolve: (response: ConfirmationResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

const CONFIRM_TIMEOUT_MS = 300_000; // 300 seconds

/**
 * RemoteGateBridge — PlatformBridge implementation that routes confirmations
 * through WebSocket to remote clients.
 */
export class RemoteGateBridge implements PlatformBridge {
  private readonly broadcastFn: BroadcastFn;
  private pending = new Map<string, PendingConfirmation>();

  constructor(broadcastFn: BroadcastFn) {
    this.broadcastFn = broadcastFn;
  }

  /**
   * Request user confirmation via WS broadcast.
   * Returns a Promise that resolves when the client sends gate.resolve,
   * or auto-denies after 300s timeout.
   */
  confirm(request: ConfirmationRequest): Promise<ConfirmationResponse> {
    // Broadcast gate.request to all connected clients
    this.broadcastFn("gate", {
      type: "gate.request",
      requestId: request.id,
      sessionId: "",
      toolName: request.toolName,
      level: String(request.level),
      summary: request.summary,
      detail: request.detail,
    } satisfies WSGateRequestEvent["data"]);

    return new Promise<ConfirmationResponse>((resolve) => {
      const timer = setTimeout(() => {
        // Auto-deny on timeout
        this.pending.delete(request.id);
        resolve({ requestId: request.id, approved: false });
      }, CONFIRM_TIMEOUT_MS);

      this.pending.set(request.id, { resolve, timer });
    });
  }

  /**
   * Resolve a pending confirmation request.
   * Called when a client sends gate.resolve command.
   */
  resolve(requestId: string, approved: boolean): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve({ requestId, approved });
    return true;
  }

  /**
   * Notify user (non-blocking).
   */
  notify(message: string): void {
    this.broadcastFn("gate", {
      type: "gate.notify",
      message,
    } satisfies WSGateNotifyEvent["data"]);
  }

  /**
   * Get platform context.
   */
  getPlatformContext(): PlatformContext {
    return {
      kind: PlatformKind.CLI,
      foreground: true,
      idle: false,
    };
  }

  /**
   * Cancel all pending confirmations (for shutdown).
   * Rejects with approved: false.
   */
  cancelAll(): void {
    for (const [requestId, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ requestId, approved: false });
    }
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
