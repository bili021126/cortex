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
import type { CompactionResult } from "./context-compactor.js";
import type { SessionSnapshot } from "./session-store.js";

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
  | TuiCompactionEvent
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

/** 上下文压缩事件 */
export interface TuiCompactionEvent {
  type: "compaction";
  /** 被压缩/移除的消息数 */
  compactedCount: number;
  /** 压缩摘要（供渲染层展示） */
  summary: string;
  /** 应用了哪些压缩层 */
  appliedLayers: number[];
  /** 压缩后估算 token 数 */
  estimatedTokens: number;
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
 * 对标 Claude Code 的 26 个可编程 Hook 事件。
 * 各 mode 通过配置不同的 hooks 实现差异化行为，
 * 而非写不同的执行路径。
 */
export interface TuiHooks {
  // ── 会话级（4）──
  /** 会话启动 */
  onSessionStart?: (mode: ReplMode, agent: AgentType) => void;
  /** 会话结束（退出前清理） */
  onSessionEnd?: () => Promise<void>;
  /** 会话持久化前 */
  onSessionSave?: (snapshot: SessionSnapshot) => void;
  /** 会话恢复后 */
  onSessionRestore?: (snapshot: SessionSnapshot) => void;

  // ── 请求级（4）──
  /** LLM 请求发送前（可修改 messages） */
  onPreModelRequest?: (messages: LlmMessage[]) => Promise<LlmMessage[]>;
  /** LLM 请求返回后 */
  onPostModelRequest?: (response: { content: string | null; tool_calls?: { id: string; name: string; arguments: Record<string, unknown> }[]; usage?: { prompt_tokens: number; completion_tokens: number } }) => void;
  /** 工具调用前的权限拦截（已有） */
  onPreToolUse?: (event: TuiToolStartEvent) => Promise<"allow" | "deny" | "skip">;
  /** 工具调用后的审计记录（已有） */
  onPostToolUse?: (event: TuiToolResultEvent) => Promise<void>;

  // ── 压缩级（3）──
  /** 上下文压缩前 */
  onPreCompact?: (messages: LlmMessage[]) => Promise<void>;
  /** 上下文压缩后 */
  onPostCompact?: (result: CompactionResult) => void;
  /** 上下文用量警告（50%/80% 阈值） */
  onCompactionWarning?: (percent: number) => void;

  // ── 错误级（3）──
  /** 通用错误 */
  onError?: (error: Error, context: string) => void;
  /** 工具执行错误 */
  onToolError?: (tool: string, error: Error) => void;
  /** 达到最大工具调用轮次 */
  onMaxToolRounds?: () => void;

  // ── 输入级（3）──
  /** 用户原始输入 */
  onUserInput?: (input: string) => Promise<string>;
  /** 输入预处理 */
  onPreProcessInput?: (input: string) => Promise<string>;
  /** 输出后处理 */
  onPostProcessOutput?: (output: string) => Promise<string>;

  // ── 模式级（3）──
  /** 模式切换 */
  onModeChange?: (from: ReplMode, to: ReplMode) => void;
  /** Agent 切换 */
  onAgentSwitch?: (from: AgentType, to: AgentType) => void;
  /** 三人模式切换 */
  onTalkTrioToggle?: (enabled: boolean) => void;

  // ── 流式级（3）──
  /** 流式开始 */
  onStreamStart?: () => void;
  /** 流式结束 */
  onStreamEnd?: () => void;
  /** LLM 输出 chunk 的自定义处理（已有） */
  onChunk?: (event: TuiLlmChunkEvent) => void;

  // ── 节点级（3）──
  /** 节点开始 */
  onNodeStart?: (nodeId: string, nodeType: string, agent: AgentType) => void;
  /** 节点完成后的回调（已有） */
  onNodeComplete?: (event: TuiNodeCompleteEvent) => void;
  /** 节点失败后的回调（已有） */
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
    reasoning_content?: string;
  }>;

  /** 执行工具调用——TUI 层通过此方法将 LLM 产出的 tool_call 转发到引擎 Toolkit */
  executeToolCall(name: string, args: Record<string, unknown>): Promise<{ success: boolean; output: string }>;

  /** 获取 Agent 可用的工具定义（供 LLM function calling）。返回 ToolDef 兼容格式 */
  getToolDefs(agent: AgentType): { name: string; description: string; parameters?: Record<string, unknown> }[];

  /** 获取模型名 */
  getChatModelName(): string;
  getReasonerModelName(): string;
}
