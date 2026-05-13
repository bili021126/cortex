// ============================================================
// @cortex/shared — 基础设施类型域
// PipelineObserver、SafeErrorReporter、LLM 协议、Agent 接口
//
// 已拆出：toolkit.ts（工具+确认门+信任） / file-lock-manager.ts / cli-adapter.ts
// ============================================================

import type { AgentType } from "./agent.js";
import type { AgentStatus } from "./agent.js";
import type { TaskNode, NodeResult } from "./task.js";

// ─── PipelineObserver ──────────────────────────────────────

export enum PipelinePriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
}

/**
 * 事件类型枚举——封闭集合，镜像代码库中所有 emit 点。
 * 用枚举替代裸 string，编译期约束事件名拼写。
 */
export enum PipelineEventType {
  // ── AgentPool ──
  AgentPoolInvariantViolation = "agent_pool.invariant_violation",
  AgentPoolDestroyBypass = "agent_pool.destroy_bypass",
  // ── Scheduler ──
  SchedulerLayerStart = "scheduler.layer.start",
  SchedulerLoopCrashed = "scheduler.loop_crashed",
  SchedulerDone = "scheduler.done",
  SchedulerReplanLimit = "scheduler.replan.limit",
  SchedulerReplanNoMetaAgent = "scheduler.replan.no_meta_agent",
  SchedulerReplanFailed = "scheduler.replan.failed",
  SchedulerNonstandardType = "scheduler.nonstandard_type",
  SchedulerInvariantViolation = "scheduler.invariant_violation",
  // ── Node 生命周期 ──
  NodeStart = "node.start",
  NodeComplete = "node.complete",
  NodeFailed = "node.failed",
  NodeReplan = "node.replan",
  NodeReplanQueued = "node.replan.queued",
  NodeSpawnFailed = "node.spawn_failed",
  // ── Pool ──
  PoolDestroyFailed = "pool.destroy_failed",
  // ── MemoryStore ──
  MemoryDbWriteFailed = "memory.db_write_failed",
  MemoryWriteBlocked = "memory.write_blocked",
  MemoryFlushSkipped = "memory.flush_skipped",
  MemoryPersistFailed = "memory.persist_failed",
  MemorySqlDegraded = "memory.sql_degraded",
  MemoryDeserializeFailed = "memory.deserialize_failed",
  // ── TaskBoard ──
  TaskBoardInvariantViolation = "task_board.invariant_violation",
  // ── Error system (PipelineObserver internal) ──
  ErrorReported = "error.reported",
  ErrorSilentUpgraded = "error.silent_upgraded",
  // ── Analysis ──
  Analysis = "analysis",
}

/**
 * 事件 Payload 类型联合——按事件类型锁定额外字段。
 * 不在枚举中的事件类型不会通过类型检查。
 */
export type EventPayloadMap = {
  [PipelineEventType.AgentPoolInvariantViolation]: { source: string; transition?: string; detail: string };
  [PipelineEventType.AgentPoolDestroyBypass]: { agentType: AgentType; instanceId: string };
  [PipelineEventType.SchedulerLayerStart]: { layer: number; nodes: number; round: number };
  [PipelineEventType.SchedulerLoopCrashed]: { round: number; error: string };
  [PipelineEventType.SchedulerDone]: { total: number; completed: number; failed: number; durationMs: number; rounds: number };
  [PipelineEventType.SchedulerReplanLimit]: { totalReplans: number; maxReplans: number };
  [PipelineEventType.SchedulerReplanNoMetaAgent]: { orphanCount: number; hint: string };
  [PipelineEventType.SchedulerReplanFailed]: { nodeId: string; error: string };
  [PipelineEventType.SchedulerNonstandardType]: { nodeId: string; nodeType: string; matchedCount: number; assigned: string; totalAgents: number };
  [PipelineEventType.SchedulerInvariantViolation]: { nodeId: string; message: string };
  [PipelineEventType.NodeStart]: { nodeId: string; type: string };
  [PipelineEventType.NodeComplete]: { nodeId: string; agentType: AgentType; success: true; output?: string };
  [PipelineEventType.NodeFailed]: { nodeId: string; error: string; agentType?: AgentType };
  [PipelineEventType.NodeReplan]: { nodeId: string; reason: string; attempt: number };
  [PipelineEventType.NodeReplanQueued]: { nodeId: string; reason: string; attempt: number };
  [PipelineEventType.NodeSpawnFailed]: { nodeId: string; agentType: AgentType; reason: string };
  [PipelineEventType.PoolDestroyFailed]: { agentType: AgentType; instanceId: string; error: string };
  [PipelineEventType.MemoryDbWriteFailed]: { operation: string; error: string };
  [PipelineEventType.MemoryWriteBlocked]: { reason: string };
  [PipelineEventType.MemoryFlushSkipped]: { frameStart: number; spentMs: number };
  [PipelineEventType.MemoryPersistFailed]: { operation: string; error: string };
  [PipelineEventType.MemorySqlDegraded]: { operation: string; detail: string };
  [PipelineEventType.MemoryDeserializeFailed]: { rowId: string; error: string };
  [PipelineEventType.TaskBoardInvariantViolation]: { source: string; detail: string };
  [PipelineEventType.ErrorReported]: { source: string; severity: string; error: string; hint?: string };
  [PipelineEventType.ErrorSilentUpgraded]: { source: string; consecutive: number; threshold: number; lastError: string; hint?: string };
  [PipelineEventType.Analysis]: unknown;
};

/** 类型化 ObservableEvent——type 必须是枚举成员，payload 按 type 锁定
 *
 * @governance 久岐忍 P2-6：Cortex 可观测性管道结构性缺陷 → 已闭合
 *   requestId 使下游可区分"未上报"与"上报失败"，消除报警盲区。
 */
export interface ObservableEvent<T extends PipelineEventType = PipelineEventType> {
  type: T;
  priority: PipelinePriority;
  payload: T extends keyof EventPayloadMap ? EventPayloadMap[T] : unknown;
  timestamp: number;
  /**
   * 幂等键——每次 emit 生成的唯一标识。
   * 下游（Sentry/Datadog/管家）可用此字段去重和链路追踪。
   * 由 PipelineObserver.emit() 自动填充（若调用方未提供）。
   */
  requestId?: string;
  /**
   * 通知语义类型。
   *   FYI              — 信息告知，用户看一眼即可
   *   WARNING          — 异常警告，用户可能需要介入
   *   DECISION_REQUIRED — 治理呈报，用户必须响应（走 ConfirmGate）
   * undefined 为向后兼容，行为不变。
   */
  notificationType?: "FYI" | "WARNING" | "DECISION_REQUIRED";
}

export type PipelineHandler = (event: ObservableEvent) => void;

// ─── SafeErrorReporter ─────────────────────────────────────

/** 安全错误上下文——统一擦除点，杜绝静默吞错 */
export interface SafeErrorContext {
  /** 错误来源标识，如 "InspectorAgent._collectFacts" */
  source: string;
  /** 原始错误对象 */
  error: unknown;
  /** 严重级别：fatal(阻断)/degraded(降级)/silent(有意忽略) */
  severity: "fatal" | "degraded" | "silent";
  /** 可选附加提示 */
  hint?: string;
}

/**
 * SafeErrorReporter —— 统一错误上报回调。
 *
 * 治理判例 NG-2026-0509-Persist-False-Positive（假阳性禁止原则）：
 * 持久化失败必须传播为操作失败，不得静默返回成功。
 *
 * silent 级别的错误连续发生 N=3 次后自动升级为 degraded，
 * 防止"有意忽略"退化为"习惯性忽略"。升级逻辑由调用方（PipelineObserver）实现。
 */
export type SafeErrorReporter = (ctx: SafeErrorContext) => void;

// ─── LLM 协议 ─────────────────────────────────────────────

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: LlmToolCall[];
  name?: string;
  reasoning_content?: string; // V4-Flash 思考模式：多轮对话需回传
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmResponse {
  content: string | null;
  toolCalls: LlmToolCall[];
  reasoning_content?: string; // V4-Flash 思考模式：需在下一轮 assistant 消息中回传
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmAdapterConfig {
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  reasonerModel: string;
  reasoningEffort?: "high" | "max"; // V4-Flash 思考模式推理深度
}

// ─── Agent 接口（定义于此以解耦 agent ↔ task 循环依赖） ───

/** Agent 接口——所有 Agent 类必须实现此接口 */
export interface Agent {
  readonly type: AgentType;
  readonly status: AgentStatus;
  wakeup(): Promise<void>;
  execute(node: TaskNode, model: string): Promise<NodeResult>;
  shutdown(): Promise<void>;
}

/** Agent 配置（权限由 Toolkit 层 AGENT_TOOL_PERMISSIONS 管理） */
export interface AgentConfig {
  type: AgentType;
  maxInstances: number;
}
