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
        // WS 修复：create 沿用客户端 sessionId（此前 randomUUID——client 过滤事件永不匹配）
        session = sessionManager.create(agent ?? "cyrene", mode ?? "chat", (msg) => {
          // Route session send through the targeted sendFn
          if (typeof msg === "object" && msg !== null && "channel" in msg && "data" in msg) {
            const { channel, data } = msg as { channel: string; data: unknown };
            sendFn(channel, data);
          }
        }, sessionId);
      } else {
        // R12-H5：WS 复用会话时更新 send（REST 创建的 session send 是 no-op——流式事件静默消失）
        session.send = (msg) => {
          if (typeof msg === "object" && msg !== null && "channel" in msg && "data" in msg) {
            const { channel, data } = msg as { channel: string; data: unknown };
            sendFn(channel, data);
          }
        };
      }

      // Restore history if provided
      if (history && history.length > 0) {
        // R12-H4：history 元素形状校验——role 缺失/非法的条目丢弃（此前零校验直达 LLM 消息链）
        session.history = history
          .filter((m) => m && typeof m === "object" && (m.role === "user" || m.role === "assistant"))
          .map((m) => ({
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
