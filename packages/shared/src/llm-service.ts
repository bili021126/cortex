// ============================================================
// @cortex/shared — 统一 LLM 调用契约（ILlmService）
//
// 记忆等 L1 子系统经此接口注入主 LLM 栈，避免同层直连。
// ILlmService 放在 L0（shared），具体实现在组装根注入。
//
// @since M4 — Cyrene 记忆栈 LLM 可插拔化
// ============================================================

/** LLM 调用消息（简化版，不含 tool_call 等复杂结构） */
export interface ILlmServiceMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** LLM 调用响应 */
export interface ILlmServiceResponse {
  text: string;
  usage?: { input: number; output: number };
}

/**
 * 统一 LLM 调用契约——记忆等 L1 子系统经此注入主 LLM 栈。
 *
 * 接口设计面向记忆场景的简单 chat 调用（无需 tool_calls/stream），
 * 若未来其他 L1 子系统需更复杂的调用可扩展 options。
 *
 * @contract
 * - chat(): 发送消息返回文本响应
 * - 无额外状态/副作用（纯函数式）
 * - 实现方负责熔断/限流/路由/遥测
 */
export interface ILlmService {
  /**
   * 发送 chat 请求。
   * @param messages    消息列表（system + user/assistant 轮次）
   * @param options     可选参数（maxTokens, model 覆盖）
   * @returns           包含响应文本及可选用量统计
   */
  chat(
    messages: ILlmServiceMessage[],
    options?: { maxTokens?: number; model?: string },
  ): Promise<ILlmServiceResponse>;
}
