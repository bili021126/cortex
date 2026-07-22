/**
 * @cortex/server — Chat Handler (HTTP)
 *
 * Handles POST /api/v1/chat — non-streaming chat endpoint.
 * Creates a temporary session, collects output, returns ChatResponse.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChatExecutor } from "../chat-executor.js";
import type { SessionManager } from "../session-manager.js";
import type { ChatRequest } from "@cortex/protocol";
import { readBody, sendJson, sendProblem } from "./router.js";

/**
 * Handle POST /api/v1/chat
 */
export async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  chatExecutor: ChatExecutor,
  sessionManager: SessionManager,
): Promise<void> {
  try {
    const body = await readBody(req);
    let parsed: ChatRequest;
    try {
      parsed = JSON.parse(body) as ChatRequest;
    } catch {
      sendProblem(res, 400, "Bad Request", "Invalid JSON body");
      return;
    }

    if (!parsed.input || typeof parsed.input !== "string") {
      sendProblem(res, 422, "Validation Error", "Field 'input' is required and must be a string");
      return;
    }

    const agent = parsed.agent ?? "cyrene";
    const mode = parsed.mode ?? "chat";

    // Collect output chunks
    const chunks: string[] = [];
    let errorMsg: string | null = null;
    let usage: { promptTokens: number; completionTokens: number } | undefined;

    // Create a temporary session with a collecting send function
    const session = sessionManager.create(agent, mode, (msg: unknown) => {
      if (typeof msg !== "object" || msg === null) return;
      const { data } = msg as { data?: Record<string, unknown> };
      if (!data) return;

      switch (data.type) {
        case "chat.chunk":
          if (typeof data.content === "string") {
            chunks.push(data.content);
          }
          break;
        case "chat.complete":
          if (typeof data.output === "string" && chunks.length === 0) {
            chunks.push(data.output);
          }
          if (data.usage && typeof data.usage === "object") {
            usage = data.usage as { promptTokens: number; completionTokens: number };
          }
          break;
        case "chat.error":
          errorMsg = typeof data.error === "string" ? data.error : "Unknown error";
          break;
      }
    });

    // Execute chat
    await chatExecutor.execute(session, parsed.input);

    // Clean up temporary session
    sessionManager.destroy(session.id);

    if (errorMsg) {
      sendProblem(res, 500, "Chat Error", errorMsg);
      return;
    }

    const output = chunks.join("");
    sendJson(res, 200, {
      data: {
        output,
        agent,
        usage,
      },
    });
  } catch (err) {
    sendProblem(res, 500, "Internal Error", err instanceof Error ? err.message : String(err));
  }
}
