/**
 * @cortex/server — Session Handler (HTTP)
 *
 * Handles GET/POST/DELETE /api/v1/sessions endpoints.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionManager } from "../session-manager.js";
import type { CreateSessionRequest } from "@cortex/protocol";
import { readBody, sendJson, sendProblem } from "./router.js";

/**
 * Handle GET /api/v1/sessions
 */
export function handleSessionGet(
  res: ServerResponse,
  sessionManager: SessionManager,
): void {
  const sessions = sessionManager.list();
  sendJson(res, 200, { data: sessions });
}

/**
 * Handle POST /api/v1/sessions
 */
export async function handleSessionPost(
  req: IncomingMessage,
  res: ServerResponse,
  sessionManager: SessionManager,
): Promise<void> {
  try {
    const body = await readBody(req);
    let parsed: CreateSessionRequest = {};
    if (body.trim()) {
      try {
        parsed = JSON.parse(body) as CreateSessionRequest;
      } catch {
        sendProblem(res, 400, "Bad Request", "Invalid JSON body");
        return;
      }
    }

    const agent = parsed.agent ?? "cyrene";
    const mode = parsed.mode ?? "chat";

    // Create session with a no-op send (HTTP sessions don't push)
    const session = sessionManager.create(agent, mode, () => {});

    sendJson(res, 201, {
      data: {
        id: session.id,
        agent: session.agent,
        mode: session.mode,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        messageCount: session.messageCount,
      },
    });
  } catch (err) {
    sendProblem(res, 500, "Internal Error", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Handle DELETE /api/v1/sessions/:id
 */
export function handleSessionDelete(
  res: ServerResponse,
  sessionManager: SessionManager,
  id: string,
): void {
  if (!id) {
    sendProblem(res, 400, "Bad Request", "Session ID is required");
    return;
  }

  const existed = sessionManager.get(id) !== undefined;
  sessionManager.destroy(id);

  sendJson(res, 200, { deleted: existed });
}
