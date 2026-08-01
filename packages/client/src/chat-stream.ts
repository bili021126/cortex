/**
 * @cortex/client — 高层流式对话 Helper
 *
 * 在 CortexConnection 之上封装 WebSocket chat channel 的事件路由：
 * 调用方只需提供回调，无需手动订阅/取消订阅 channel 或匹配 sessionId。
 */

import type { CortexConnection } from "./connection.js";
import type {
  WSGateRequestEvent,
  WSChatCompleteEvent,
} from "@cortex/protocol";

/** 流式对话回调集合 */
export interface ChatStreamCallbacks {
  /** 收到流式文本块（reasoning 为可选的思考链内容） */
  onChunk: (content: string, reasoning?: string) => void;
  /** 工具开始执行（B6：补全 toolCallId/agent） */
  onToolStart?: (toolName: string, input: string, toolCallId: string, agent: string) => void;
  /** 工具执行完成（B6：补全 toolCallId/durationMs） */
  onToolResult?: (
    toolName: string,
    success: boolean,
    output: string,
    toolCallId: string,
    durationMs: number,
  ) => void;
  /** 收到确认门请求（调用 conn.ws.resolveGate 回复） */
  onGateRequest?: (request: WSGateRequestEvent["data"]) => void;
  /** 对话完成（B6：补全 usage/reasoning） */
  onComplete: (
    output: string,
    usage?: WSChatCompleteEvent["data"]["usage"],
    reasoning?: string,
  ) => void;
  /** 对话出错 */
  onError: (error: string) => void;
}

/** 流式对话句柄，可用于取消 */
export interface ChatStreamHandle {
  sessionId: string;
  cancel: () => void;
}

/**
 * 发起流式对话并路由事件到回调。
 * 自动订阅 "chat" 和 "gate" channel，并在结束/取消时清理监听器。
 */
export function streamChat(
  conn: CortexConnection,
  input: string,
  callbacks: ChatStreamCallbacks,
  opts?: { agent?: string; mode?: "chat" | "talk" | "plan" | "party" | "command" },
): ChatStreamHandle {
  const sessionId = conn.ws.startChat({ input, agent: opts?.agent, mode: opts?.mode });

  const unsubChat = conn.ws.on("chat", (msg) => {
    // B1：data 类型已按通道收窄为 WSChatServerEvent["data"]，无需 as cast
    const data = msg.data;
    if (data.sessionId !== sessionId) return;
    switch (data.type) {
      case "chat.chunk":
        callbacks.onChunk(data.content, data.reasoning);
        break;
      case "chat.tool_start":
        callbacks.onToolStart?.(data.toolName, data.input, data.toolCallId, data.agent);
        break;
      case "chat.tool_result":
        callbacks.onToolResult?.(data.toolName, data.success, data.output, data.toolCallId, data.durationMs);
        break;
      case "chat.complete":
        cleanup();
        callbacks.onComplete(data.output, data.usage, data.reasoning);
        break;
      case "chat.error":
        cleanup();
        callbacks.onError(data.error);
        break;
    }
  });

  const unsubGate = conn.ws.on("gate", (msg) => {
    // B1：类型收窄为 WSGateServerEvent["data"]
    const data = msg.data;
    if (data.type === "gate.request") {
      callbacks.onGateRequest?.(data);
    }
  });

  function cleanup() {
    unsubChat();
    unsubGate();
  }

  return {
    sessionId,
    cancel: () => {
      conn.ws.cancelChat(sessionId);
      cleanup();
    },
  };
}
