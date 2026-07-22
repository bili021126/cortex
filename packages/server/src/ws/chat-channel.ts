/**
 * @cortex/server — Chat Channel Handler
 *
 * Routes chat.start and chat.cancel WS commands to the ChatExecutor.
 */

import type { WSChatStartCommand, WSChatCancelCommand } from "@cortex/protocol";
import type { SessionManager } from "../session-manager.js";
import type { ChatExecutor } from "../chat-executor.js";

/** Send function for targeted WS delivery */
type SendFn = (channel: string, data: unknown) => void;

/**
 * Handle chat.start and chat.cancel commands.
 */
export function handleChatCommand(
  cmd: WSChatStartCommand | WSChatCancelCommand,
  sessionManager: SessionManager,
  chatExecutor: ChatExecutor,
  sendFn: SendFn,
): void {
  switch (cmd.type) {
    case "chat.start": {
      const { sessionId, input, mode, agent, history } = cmd;

      // Try to reuse existing session or create new one
      let session = sessionManager.get(sessionId);
      if (!session) {
        session = sessionManager.create(agent ?? "cyrene", mode ?? "chat", (msg) => {
          // Route session send through the targeted sendFn
          if (typeof msg === "object" && msg !== null && "channel" in msg && "data" in msg) {
            const { channel, data } = msg as { channel: string; data: unknown };
            sendFn(channel, data);
          }
        });
      }

      // Restore history if provided
      if (history && history.length > 0) {
        session.history = history.map((m) => ({
          role: m.role,
          content: m.content ?? "",
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          ...(m.tool_calls ? {
            tool_calls: m.tool_calls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: typeof tc.arguments === "string" ? safeParse(tc.arguments) : tc.arguments,
            })),
          } : {}),
        }));
      }

      // Execute asynchronously — don't block the WS message handler
      void chatExecutor.execute(session, input);
      break;
    }

    case "chat.cancel": {
      const { sessionId } = cmd;
      const session = sessionManager.get(sessionId);
      if (session) {
        session.abortController.abort();
      }
      break;
    }
  }
}

function safeParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return {};
  }
}
