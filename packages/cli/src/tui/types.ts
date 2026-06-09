/**
 * tui/types.ts — TUI 领域类型定义
 *
 * TUI 渲染-执行一体化模块的类型中枢。定义了执行事件流、
 * 生命周期钩子、节点渲染状态等所有 TUI 渲染层需要的类型。
 *
 * @module tui/types
 * @since v3 — CLI TUI 全栈重构
 */

import type { AgentType, LlmMessage, TaskNode } from "@cortex/shared";

// ─── 复用 REPL 模式类型 ───────────────────────

/** REPL 运行模式（与老 repl/types.ts 的 ReplMode 同构） */
export type ReplMode = "command" | "chat" | "talk" | "plan" | "party";

// ─── 执行事件流 ───────────────────────────────

/**
 * TuiEvent — Engine → TUI 的实时事件联合类型。
 *
 * queryLoop 作为 async generator yield 的事件，由各渲染组件订阅。
 * 每个事件携带足够信息让渲染层独立决策如何展示。
 */
export type TuiEvent =
  | TuiToolStartEvent
  | TuiToolResultEvent
  | TuiLlmChunkEvent
  | TuiNodeStartEvent
  | TuiNodeCompleteEvent
  | TuiNodeFailedEvent
  | TuiPermissionRequiredEvent
  | TuiTaskTreeUpdateEvent
  | TuiTokenUsageEvent
  | TuiLifecycleEvent;

/** 工具调用开始 */
export interface TuiToolStartEvent {
  type: "tool_start";
  agent: AgentType;
  tool: string;
  input: string;
  nodeId?: string;
  /** 是否为高风险操作（L3 不可逆） */
  highRisk?: boolean;
}

/** 工具调用结果 */
export interface TuiToolResultEvent {
  type: "tool_result";
  agent: AgentType;
  tool: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
  nodeId?: string;
}

/** LLM 流式输出 chunk */
export interface TuiLlmChunkEvent {
  type: "llm_chunk";
  agent: AgentType;
  content: string;
  /** 思考内容（reasoner 模型） */
  reasoning?: string;
}

/** 任务节点开始执行 */
export interface TuiNodeStartEvent {
  type: "node_start";
  nodeId: string;
  nodeType: string;
  agent: AgentType;
  description: string;
  parentId?: string;
}

/** 任务节点执行完成 */
export interface TuiNodeCompleteEvent {
  type: "node_complete";
  nodeId: string;
  agent: AgentType;
  output: string;
  durationMs: number;
}

/** 任务节点执行失败 */
export interface TuiNodeFailedEvent {
  type: "node_failed";
  nodeId: string;
  agent: AgentType;
  error: string;
  durationMs: number;
}

/** 权限确认请求 */
export interface TuiPermissionRequiredEvent {
  type: "permission_required";
  agent: AgentType;
  tool: string;
  input: string;
  /** 可逆性等级 L1/L2/L3 */
  reversibilityLevel: 1 | 2 | 3;
  nodeId?: string;
}

/** 任务树结构更新 */
export interface TuiTaskTreeUpdateEvent {
  type: "task_tree_update";
  nodes: TaskNode[];
}

/** Token 用量更新 */
export interface TuiTokenUsageEvent {
  type: "token_usage";
  promptTokens: number;
  completionTokens: number;
  sessionTotalTokens: number;
  contextWindowSize: number;
}

/** 生命周期事件 */
export interface TuiLifecycleEvent {
  type: "session_start" | "session_end" | "mode_change";
  mode?: ReplMode;
  agent?: AgentType;
}

// ─── 生命周期钩子 ──────────────────────────────

/**
 * TuiHooks — 查询循环生命周期钩子。
 *
 * 各 mode 通过配置不同的 hooks 实现差异化行为，
 * 而非写不同的执行路径。
 */
export interface TuiHooks {
  /** 工具调用前的权限拦截 */
  onPreToolUse?: (event: TuiToolStartEvent) => Promise<"allow" | "deny" | "skip">;

  /** 工具调用后的审计记录 */
  onPostToolUse?: (event: TuiToolResultEvent) => Promise<void>;

  /** LLM 输出 chunk 的自定义处理 */
  onChunk?: (event: TuiLlmChunkEvent) => void;

  /** 节点完成后的回调 */
  onNodeComplete?: (event: TuiNodeCompleteEvent) => void;

  /** 节点失败后的回调 */
  onNodeFailed?: (event: TuiNodeFailedEvent) => void;
}

// ─── 节点渲染状态 ──────────────────────────────

/** 任务树中单个节点的渲染状态 */
export type NodeRenderStatus = "pending" | "executing" | "done" | "failed" | "skipped";

export interface NodeRenderState {
  nodeId: string;
  parentId?: string;
  agent: AgentType;
  description: string;
  status: NodeRenderStatus;
  output?: string;
  durationMs?: number;
  error?: string;
  /** 嵌套深度（用于缩进渲染） */
  depth: number;
}

// ─── 确认门结果 ─────────────────────────────────

export type ConfirmResult = "approve_once" | "approve_all" | "deny" | "skip";

// ─── 查询循环上下文 ─────────────────────────────

/** queryLoop 的输入上下文 */
export interface QueryLoopContext {
  input: string;
  mode: ReplMode;
  agent: AgentType;
  hooks: TuiHooks;
  /** 对话历史（多轮） */
  history?: LlmMessage[];
  /** Plan 模式的计划节点集合 */
  planNodes?: TaskNode[];
}

// ─── LLM 流式接口 ─────────────────────────────

/** LLM 流式对话接口——queryLoop 消费此抽象，不直接依赖 LlmAdapter */
export interface LlmStreamBridge {
  /** 流式聊天——每收到 chunk 回调 onChunk */
  streamChat(
    model: string,
    messages: LlmMessage[],
    tools: { name: string; description: string; parameters?: Record<string, unknown> }[] | undefined,
    onChunk: (content: string, reasoning?: string) => void,
    opts?: { reasoningEffort?: "high" | "max" },
  ): Promise<{
    content: string | null;
    tool_calls?: { id: string; name: string; arguments: Record<string, unknown> }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  }>;

  /** 执行工具调用——TUI 层通过此方法将 LLM 产出的 tool_call 转发到引擎 Toolkit */
  executeToolCall(name: string, args: Record<string, unknown>): Promise<{ success: boolean; output: string }>;

  /** 获取模型名 */
  getChatModelName(): string;
  getReasonerModelName(): string;
}
