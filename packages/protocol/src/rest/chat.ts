/**
 * @cortex/protocol — POST /chat 类型
 *
 * 非流式对话端点——适用于简单客户端（如 Desktop 非流式模式）。
 * 流式对话走 WebSocket chat channel。
 */

import type { SingleResponse } from "./pagination.js";

/** POST /chat 请求体 */
export interface ChatRequest {
  input: string;
  agent?: string;
  mode?: "chat" | "talk" | "plan" | "party" | "command";
}

/** 对话响应中的 usage 信息 */
export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

/** POST /chat 响应 data */
export interface ChatResponseData {
  output: string;
  agent: string;
  usage?: ChatUsage;
}

/** POST /chat 完整响应 */
export type ChatResponse = SingleResponse<ChatResponseData>;
