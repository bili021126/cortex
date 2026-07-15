// ============================================================
// @cortex/shared — TUI EngineBridge 类型化契约
//
// 定义 ITuiEngineBridge——TUI 层消费引擎能力的接口抽象。
// EngineBridge（CLI）实现此接口，TUI 层通过它调用引擎能力。
// 所有方法签名与 ICortexApi / LlmStreamBridge 对齐。
//
// @since v3 — CLI TUI 全栈重构 Stage 2
// ============================================================

import type { AgentType } from "./agent.js";
import type { LlmMessage } from "./infra.js";
import type { MemoryEntry, MemoryQuery, MemoryWriteInput } from "./memory.js";
import type { TaskNode, ExecutionReport } from "./task.js";

export interface ITuiEngineBridge {
  /** 获取聊天模型名 */
  getChatModelName(): string;
  /** 获取推理模型名 */
  getReasonerModelName(): string;
  /** 获取 Agent 工具定义 */
  getToolDefs(agent: AgentType): { name: string; description: string; parameters?: Record<string, unknown> }[];
  /** 流式 LLM 对话 */
  streamChat(
    model: string,
    messages: LlmMessage[],
    tools: { name: string; description: string; parameters?: Record<string, unknown> }[] | undefined,
    onChunk: (content: string, reasoning?: string) => void,
    opts?: { reasoningEffort?: "high" | "max" | null },
  ): Promise<{
    content: string | null;
    tool_calls?: { id: string; name: string; arguments: Record<string, unknown> }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
    reasoning_content?: string;
  }>;
  /** 执行工具调用 */
  executeToolCall(name: string, args: Record<string, unknown>): Promise<{ success: boolean; output: string }>;
  /** 非流式 LLM 对话（摘要/压缩） */
  chat(systemPrompt: string, messages: LlmMessage[], opts?: { model?: string; reasoningEffort?: "high" | "max" }): Promise<string>;
  /** 初始化昔涟独立记忆 */
  ensureTalkMemory(): Promise<void>;
  /** 读取昔涟记忆 */
  readTalkMemory(query: MemoryQuery): Promise<MemoryEntry[]>;
  /** 写入昔涟记忆 */
  writeTalkMemory(entry: MemoryWriteInput): Promise<void>;
  /** 流式执行任务节点（plan mode） */
  executeWithStream(nodes: TaskNode[], onEvent: (event: unknown) => void): Promise<ExecutionReport>;
  /** 获取 MetaAgent（甘雨）——用于 plan mode 生成任务计划 */
  getMetaAgent?(): Promise<IMetaAgent | undefined>;
}

/** 最小 MetaAgent 契约——plan mode 任务规划 */
export interface IMetaAgent {
  plan(intent: string, context?: Record<string, unknown>): Promise<TaskNode[]>;
}
