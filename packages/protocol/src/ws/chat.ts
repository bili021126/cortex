/**
 * @cortex/protocol — Chat WebSocket 协议
 *
 * 定义客户端与 daemon 之间的流式对话通信类型。
 * 客户端发送 chat.start 发起对话，服务端通过 chat channel 推送流式事件。
 */

// ─── 客户端 → 服务端命令 ─────────────────────────────────────────────

/** LLM 消息 DTO（用于传递对话历史） */
export interface LlmMessageDTO {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: { id: string; name: string; arguments: string }[];
}

/** 发起对话命令 */
export interface WSChatStartCommand {
  type: "chat.start";
  sessionId: string;
  input: string;
  mode: "chat" | "talk" | "plan" | "party" | "command";
  agent: string;
  history?: LlmMessageDTO[];
}

/** 取消对话命令 */
export interface WSChatCancelCommand {
  type: "chat.cancel";
  sessionId: string;
}

// ─── 服务端 → 客户端事件 ─────────────────────────────────

/** 流式文本块 */
export interface WSChatChunkEvent {
  channel: "chat";
  data: {
    type: "chat.chunk";
    sessionId: string;
    content: string;
    reasoning?: string;
  };
}

/** 工具开始执行 */
export interface WSChatToolStartEvent {
  channel: "chat";
  data: {
    type: "chat.tool_start";
    sessionId: string;
    toolCallId: string;
    toolName: string;
    input: string;
    agent: string;
  };
}

/** 工具执行结果 */
export interface WSChatToolResultEvent {
  channel: "chat";
  data: {
    type: "chat.tool_result";
    sessionId: string;
    toolCallId: string;
    toolName: string;
    success: boolean;
    output: string;
    durationMs: number;
  };
}

/** 对话完成 */
export interface WSChatCompleteEvent {
  channel: "chat";
  data: {
    type: "chat.complete";
    sessionId: string;
    output: string;
    reasoning?: string;
    usage?: { promptTokens: number; completionTokens: number };
  };
}

/** 对话出错 */
export interface WSChatErrorEvent {
  channel: "chat";
  data: {
    type: "chat.error";
    sessionId: string;
    error: string;
  };
}

/** 所有 chat 服务端事件的联合 */
export type WSChatServerEvent =
  | WSChatChunkEvent
  | WSChatToolStartEvent
  | WSChatToolResultEvent
  | WSChatCompleteEvent
  | WSChatErrorEvent;

/** chat channel 事件 data 的 type 判别 */
export type WSChatEventType = WSChatServerEvent["data"]["type"];
