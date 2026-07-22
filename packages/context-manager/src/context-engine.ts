// ============================================================
// @cortex/context-manager — ContextEngine 可插拔接口
//
// @frozen 2026-07 — 全量图景审计确认：仅 import type 引用，
// setContextManager() 从未在生产代码中被调用。冻结不维护不评审。
//
// 适配 Cortex:
//   - ContextEngine 接口定义在 @cortex/context-manager
//   - ReactLoop 通过 DI 注入 _contextEngine?: ContextEngine
//   - 首版只实现 assemble() + compact()
//
// assemble()   — 拼接最终发给 LLM 的消息列表
// compact()    — 压缩历史消息，返回摘要替代旧消息
// ============================================================

import type { LlmMessage } from "@cortex/shared";

export interface AssembleInput {
  systemPrompt: string;
  history: LlmMessage[];
  maxTokens: number;
}

export interface AssembleResult {
  messages: LlmMessage[];
  estimatedTokens: number;
  truncated: boolean;
}

export interface ContextEngine {
  /** 拼接最终发给 LLM 的消息列表 */
  assemble(input: AssembleInput): Promise<AssembleResult>;
  /** 压缩历史消息——返回摘要替代旧消息 */
  compact?(history: LlmMessage[], maxTokens: number): Promise<LlmMessage[]>;
}
