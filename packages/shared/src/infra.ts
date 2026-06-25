// ============================================================
// @cortex/shared — 基础设施类型域
// PipelineObserver、SafeErrorReporter、LLM 协议、Agent 接口
//
// 已拆出：toolkit.ts（工具+确认门+信任） / file-lock-manager.ts / cli-adapter.ts
// ============================================================

import type { AgentType } from "./agent.js";
import type { TaskNode, ExecutionReport } from "./task.js";
import type { MemoryQuery, MemoryEntry, MemoryWriteInput, IMemoryStore } from "./memory.js";
import type { IConfirmGate } from "./toolkit.js";

// ─── PipelineObserver ──────────────────────────────────────

export enum PipelinePriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
}

/**
 * 事件类型枚举——封闭集合，镜像代码库中所有 emit 点。
 * 用枚举替代裸 string，编译期约束事件名拼写。
 *
 * @fix N-07 — 新增 NodeRemoved 事件类型，供 TaskBoard.removeNode() 使用
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
  NodeRemoved = "node.removed",
  // ── Pool ──
  PoolDestroyFailed = "pool.destroy_failed",
  // ── MemoryStore ──
  MemoryDbWriteFailed = "memory.db_write_failed",
  MemoryWriteBlocked = "memory.write_blocked",
  MemoryFlushSkipped = "memory.flush_skipped",
  MemoryPersistFailed = "memory.persist_failed",
  MemorySqlDegraded = "memory.sql_degraded",
  MemoryDeserializeFailed = "memory.deserialize_failed",
  MemoryEmbeddingWarmupFailed = "memory.embedding_warmup_failed",
  // ── TaskBoard ──
  TaskBoardInvariantViolation = "task_board.invariant_violation",
  // ── Error system (PipelineObserver internal) ──
  ErrorReported = "error.reported",
  ErrorSilentUpgraded = "error.silent_upgraded",
  // ── Analysis ──
  Analysis = "analysis",
  // ── Skill ──
  SkillReferenced = "skill.referenced",
  // ── Boundary Guard ──
  AgentBoundaryViolation = "agent.boundary_violation",
  // ── Governance ──
  ConstitutionViolation = "constitution.violation",
  ConstitutionSessionConvened = "constitution.session_convened",
  ConstitutionSessionResolved = "constitution.session_resolved",
  GovernanceAmendmentProposed = "governance.amendment_proposed",
  GovernanceAuditReport = "governance.audit_report",
  GovernanceComplianceViolation = "governance.compliance_violation",
  GovernanceRoundtableConsensus = "governance.roundtable_consensus",
  // ── RLM 递归分层执行 ──
  RlmDecompose = "rlm.decompose",
  RlmContextCompress = "rlm.context_compress",
  // ── ManifoldGate 流控 ──
  ManifoldGateWaitStart = "manifold_gate.wait_start",
  ManifoldGateWaitEnd = "manifold_gate.wait_end",
  ManifoldGateAcquireTimeout = "manifold_gate.acquire_timeout",
  ManifoldGateReleased = "manifold_gate.released",
  ManifoldGateInvariantViolation = "manifold_gate.invariant_violation",
  ManifoldGateReleaseOrphan = "manifold_gate.release_orphan",
  ManifoldGateMaxUpdated = "manifold_gate.max_updated",
  // ── Infrastructure ──
  InfraFileLockExpiredReclaimed = "infra.file_lock.expired_reclaimed",
  InfraComponentDegraded = "infra.component_degraded",

  // ── Interact（配置交互流）──
  InteractConfigOverrideApplied = "interact.config_override_applied",
  InteractConfigReloaded = "interact.config_reloaded",
  InteractConfigSchemaViolation = "interact.config_schema_violation",

  // ── Mem（记忆流）──
  MemRetrievalStrategySelected = "mem.retrieval_strategy_selected",
  MemMemoryWarmupInitiated = "mem.memory_warmup_initiated",
  MemMemoryObliterationTriggered = "mem.memory_obliteration_triggered",

  // ── Exec（执行流——调度器心跳/超时）──
  ExecNodeDelayed = "exec.node_delayed",

  // ── Tele（遥测流）──
  TeleDegradationThresholdBreached = "tele.degradation_threshold_breached",
}

/**
 * 事件 Payload 类型联合——按事件类型锁定额外字段。
 * 不在枚举中的事件类型不会通过类型检查。
 */
export type EventPayloadMap = {
  [PipelineEventType.AgentPoolInvariantViolation]: { source: string; transition?: string; detail: string };
  [PipelineEventType.AgentPoolDestroyBypass]: { agentType: AgentType; instanceId: string };
  [PipelineEventType.SchedulerLayerStart]: { layer: number; nodes: number; round: number };
  [PipelineEventType.SchedulerLoopCrashed]: { round: number; error: string; pendingAtCrash?: number; hint?: string };
  [PipelineEventType.SchedulerDone]: { total: number; completed: number; failed: number; durationMs: number; rounds: number; orphanedNodes: number };
  [PipelineEventType.SchedulerReplanLimit]: { totalReplans: number; maxReplans: number; deferred?: number };
  [PipelineEventType.SchedulerReplanNoMetaAgent]: { orphanCount: number; hint: string };
  [PipelineEventType.SchedulerReplanFailed]: { nodeId: string; error: string };
  [PipelineEventType.SchedulerNonstandardType]: { nodeId: string; nodeType: string; matchedCount: number; assigned: string; totalAgents: number };
  [PipelineEventType.SchedulerInvariantViolation]: { nodeId: string; message: string };
  [PipelineEventType.NodeStart]: { nodeId: string; type: string };
  /** 
   * NodeComplete — 节点完成事件。
   * @field perspectives 多视角节点场景下，所有参与视角的 agentType 列表；单视角节点不包含此字段。
   * @field allSuccess   多视角节点场景下，是否所有视角均成功；单视角节点不包含此字段。
   */
  [PipelineEventType.NodeComplete]: { nodeId: string; agentType: AgentType; success: true; output?: string; perspectives?: (AgentType | string | undefined)[]; allSuccess?: boolean };
  [PipelineEventType.NodeFailed]: { nodeId: string; error: string; agentType?: AgentType };
  [PipelineEventType.NodeReplan]: { nodeId: string; reason: string; attempt: number };
  [PipelineEventType.NodeReplanQueued]: { nodeId: string; reason: string; attempt: number };
  [PipelineEventType.NodeSpawnFailed]: { nodeId: string; agentType: AgentType; reason: string };
  [PipelineEventType.NodeRemoved]: { nodeId: string };
  [PipelineEventType.PoolDestroyFailed]: { agentType: AgentType; instanceId: string; error: string };
  [PipelineEventType.MemoryDbWriteFailed]: { operation: string; error: string };
  [PipelineEventType.MemoryWriteBlocked]: { reason: string };
  [PipelineEventType.MemoryFlushSkipped]: { source: string; detail: string };
  [PipelineEventType.MemoryPersistFailed]: { operation: string; error: string };
  [PipelineEventType.MemorySqlDegraded]: { operation: string; detail: string };
  [PipelineEventType.MemoryDeserializeFailed]: { rowId: string; error: string };
  [PipelineEventType.MemoryEmbeddingWarmupFailed]: { error: string };
  [PipelineEventType.TaskBoardInvariantViolation]: { source: string; detail: string };
  [PipelineEventType.ErrorReported]: { source: string; severity: string; error: string; hint?: string };
  [PipelineEventType.ErrorSilentUpgraded]: { source: string; consecutive: number; threshold: number; lastError: string; hint?: string };
  [PipelineEventType.Analysis]: unknown;
  [PipelineEventType.SkillReferenced]: {
    nodeId: string;
    agentType: AgentType;
    skillId: string;
    skillName: string;
    /** 实际采信的步骤索引（0-based） */
    stepsUsed?: number[];
    /** 跳过的步骤索引 */
    stepsSkipped?: number[];
    /** Agent 对步骤的临时调整说明 */
    adaptation?: string;
  };
  [PipelineEventType.AgentBoundaryViolation]: {
    nodeId: string;
    agentType: AgentType;
    violatingFiles: string[];
    reason: string;
    expectedScope: string;
  };
  // ── RLM 递归分层执行 ──
  [PipelineEventType.RlmDecompose]: {
    nodeId: string;
    subTaskCount: number;
    depth: number;
    confidence: number;
    rationale?: string;
  };
  [PipelineEventType.RlmContextCompress]: {
    nodeId: string;
    density: string;
    originalLength: number;
    compressedLength: number;
  };
  // ── ManifoldGate 流控 ──
  [PipelineEventType.ManifoldGateWaitStart]: { agentType: string; queuePosition: number; active: number; max: number; requestId: string };
  [PipelineEventType.ManifoldGateWaitEnd]: { agentType: string; remainingWaiters: number; requestId: string };
  [PipelineEventType.ManifoldGateAcquireTimeout]: { agentType: string; timeoutMs: number; requestId: string };
  [PipelineEventType.ManifoldGateReleased]: { agentType: string; active: number; waiting: number; requestId: string };
  [PipelineEventType.ManifoldGateInvariantViolation]: { agentType: string; message: string };
  [PipelineEventType.ManifoldGateReleaseOrphan]: { agentType: string; message: string };
  [PipelineEventType.ManifoldGateMaxUpdated]: { agentType: string; newMax: number; oldMax: number };
  // ── Infrastructure ──
  [PipelineEventType.InfraFileLockExpiredReclaimed]: { count: number; path?: string; holders?: string; detail: string };
  [PipelineEventType.InfraComponentDegraded]: { component: string; operation: string; detail: string };

  // ── Governance ──
  [PipelineEventType.ConstitutionViolation]: GovernanceEventPayload & { rule: string; detail: string };
  [PipelineEventType.ConstitutionSessionConvened]: GovernanceEventPayload & { sessionId: string };
  [PipelineEventType.ConstitutionSessionResolved]: GovernanceEventPayload & { sessionId: string; resolution: string };
  [PipelineEventType.GovernanceAmendmentProposed]: GovernanceEventPayload & { amendmentId: string };
  [PipelineEventType.GovernanceAuditReport]: GovernanceEventPayload & { auditType: "plan_review" | "doc_audit" | "constitution_check" };
  [PipelineEventType.GovernanceComplianceViolation]: GovernanceEventPayload & { violationLevel: "P0" | "P1" | "P2" | "P3" };
  [PipelineEventType.GovernanceRoundtableConsensus]: GovernanceEventPayload & { participants: string[] };

  // ── Interact（配置交互流）──
  [PipelineEventType.InteractConfigOverrideApplied]: { timestamp: number; key: string; source: 'env' | 'user' | 'project'; oldValue: unknown; newValue: unknown };
  [PipelineEventType.InteractConfigReloaded]: { timestamp: number; watchPath: string; changedKeys: string[] };
  [PipelineEventType.InteractConfigSchemaViolation]: { timestamp: number; schemaName: string; errors: { path: string; message: string }[] };

  // ── Mem（记忆流）──
  [PipelineEventType.MemRetrievalStrategySelected]: { timestamp: number; query: string; strategy: string; reason: string };
  [PipelineEventType.MemMemoryWarmupInitiated]: { timestamp: number; embeddingModel: string; dimension: number };
  [PipelineEventType.MemMemoryObliterationTriggered]: { timestamp: number; pattern: string; reason: string };

  // ── Exec（执行流——调度器心跳/超时）──
  [PipelineEventType.ExecNodeDelayed]: {
    nodeId: string;
    agentId: string;
    elapsed: number;
    action: 'wait' | 'extend';
    level: 'warn' | 'ping';
  };

  // ── Tele（遥测流）──
  [PipelineEventType.TeleDegradationThresholdBreached]: { timestamp: number; source: string; count: number; threshold: number };
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

/**
 * 治理事件统一上下文。
 * 所有治理组件 emit 的 ObservableEvent 中，payload 应符合此结构。
 */
export interface GovernanceEventPayload {
  /** 事件严重性 */
  severity: "FYI" | "WARNING" | "DECISION_REQUIRED";
  /** 发射源 */
  source: "doc-govern" | "sentinel" | "confirm-gate" | "committee" | "strategist" | "governance-loop";
  /** 摘要 */
  summary: string;
  /** 详情（可选） */
  detail?: string;
  /** 建议动作（可选） */
  suggestedAction?: "fix" | "ignore" | "escalate";
  /** 三轴归属（可选） */
  axis?: "事轴" | "权轴" | "横切";
  /** 是否需要决策（可选——权轴拦截信号） */
  requiresDecision?: boolean;
}

export type PipelineHandler = (event: ObservableEvent) => void;

/**
 * 因果链元数据——作为 emit() 的第三个可选参数传入。
 * causalChain 不在 EventPayloadMap 的 payload 中，
 * 它是 emit() 的运行时附加元数据。
 */
export interface EmitMeta {
  causalChain?: {
    spanId: string;
    directCause?: string;
    upstreamEvents?: string[];
  };
}

/**
 * IPipelineObserver —— 可观测事件管道接口。
 * PipelineObserver 实现此接口，外部可在测试/生产/桌面端注入不同的 observer 实现。
 * @since v2.8 核心组件接口化与组合式重构
 */
export interface IPipelineObserver {
  emit(event: ObservableEvent, meta?: EmitMeta): void;
  on(priority: PipelinePriority, handler: PipelineHandler): void;
  off(priority: PipelinePriority, handler?: PipelineHandler): void;
}

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

// ─── Invariant 违规上报类型（跨包通用） ──────────────────────
// @migrated-from engine/src/task-board.ts (P1 — 艾尔海森类型迁移计划)
// TaskBoard 和 AgentPool 共用同一套 invariant 上报签名，统一到 shared 中避免类型漂移。

/** invariant 违规上报上下文 */
export interface InvariantViolation {
  /** 违规来源，如 "TaskBoard.complete"、"AgentPool.setStatus" */
  source: string;
  /** 人类可读描述 */
  message: string;
  /** 附加上下文（claimedBy vs results 等） */
  details?: unknown;
}

/** invariant 违规上报回调签名。默认 console.error，外部可注入 observer.emit。 */
export type InvariantReporter = (violation: InvariantViolation) => void;

// ─── Handler 错误上报类型（跨包通用） ────────────────────────
// @migrated-from engine/src/pipeline-observer.ts (P1 — 艾尔海森类型迁移计划)
// PipelineObserver 的 handler 异常回调类型，与外部注入的错误上报后端共享。

/** handler 异常上报上下文 */
export interface HandlerErrorContext {
  eventType: string;
  priority: PipelinePriority;
  error: unknown;
  handlerIndex: number; // 异常发生在同优先级第几个 handler 上
}

/** handler 异常上报回调签名。默认降级到 console.error。外部可注入 Sentry/Datadog 等。 */
export type HandlerErrorReporter = (ctx: HandlerErrorContext) => void;

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
  tool_calls?: LlmToolCall[];
  usage?: LlmUsage;
  reasoning_content?: string; // V4-Flash 思考模式
}

export interface LlmUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

/** LLM function calling 工具定义（OpenAI 兼容格式） */
export interface ToolDef {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

/** LLM 适配器配置 */
export interface LlmAdapterConfig {
  baseUrl: string;
  apiKey: string;
  chatModel?: string;
  reasonerModel?: string;
  reasoningEffort?: "high" | "max";
  /** 权限控制标识（用于限流/配额匹配，如 "cyrene" / "chat" / "reasoner"） */
  label?: string;
  /** 供应商扩展参数（如 DeepSeek 的 thinking 模式等）。调用方显式设置，无默认值。 */
  extraBody?: Record<string, unknown>;
}

// ─── 运行时类型约束 ──────────────────────────────────────────

// ─── CLI ↔ 引擎统一通信接口 ─────────────────────────────

/** 对话选项 */
export interface ChatOptions {
  model?: string;
  reasoningEffort?: "high" | "max";
}

/**
 * ICortexApi —— CLI 与引擎的公共通信契约。
 *
 * CLI 命令只依赖此接口，不感知引擎内部组件（Scheduler/TaskBoard/MemoryStore 等）。
 * EngineBridge 实现此契约，bootstrapEngine 产出的结果也实现了此契约。
 *
 * @since v2.7 替代桥接模式的直接组件暴露
 */
export interface ICortexApi {
  // ── 生命周期 ──
  readonly ready: boolean;
  readonly bootstrapped: boolean;
  ensureReady(): Promise<void>;
  ensureBootstrapped(): Promise<void>;
  shutdown(): Promise<void>;

  // ── 直接对话（闲聊，不经调度器）──
  chat(systemPrompt: string, messages: LlmMessage[], opts?: ChatOptions): Promise<string>;

  // ── 模型名（用于 talk/trio/party 的双模型分流）──
  getChatModelName(): string;
  getReasonerModelName(): string;

  // ── 任务执行 ──
  submitTask(node: TaskNode): Promise<void>;
  executeAll(): Promise<ExecutionReport>;

  // ── Talk 专用记忆 ──
  ensureTalkMemory(): Promise<void>;
  readTalkMemory(query: MemoryQuery): Promise<MemoryEntry[]>;
  writeTalkMemory(entry: MemoryWriteInput): Promise<void>;

  // ── Agent 查询（WebUI/CLI 需具体类型展示状态）──
  getMetaAgent(): Promise<{ plan(intent: string, context?: Record<string, unknown>): Promise<unknown> } | undefined>;
  getStrategists(): Map<string, unknown> | undefined;

  // ── 确认门（已有 IConfirmGate 契约）──
  getConfirmGate(): Promise<IConfirmGate>;

  // ── 主记忆库（只读，用于获取工程上下文）──
  readMainMemory(query: MemoryQuery): Promise<MemoryEntry[]>;

  // ── 引擎组件访问（管理命令用）──
  /** 获取记忆库（管理命令：memory write/read/search/link/archive/freeze/obliterate） */
  getMemoryStore(): Promise<IMemoryStore>;

  /** 获取任务板（返回具体类型，WebUI 需展示任务状态） */
  getTaskBoard(): Promise<{ getNode(id: string): unknown; getAllNodes(): unknown[]; addNode(node: unknown): void }>;

  /** 获取调度器（返回具体类型，WebUI 需触发执行） */
  getScheduler(): Promise<{ executeAll(): Promise<unknown>; register(type: string, agent: unknown, model: string): void }>;

  /** 获取 AgentPool（管理命令：agent list/inspect/spawn/destroy） */
  getAgentPool(): unknown;
}

// ─── 运行时类型约束 ──────────────────────────────────────────

/**
 * Disposable —— 资源清理契约。
 *
 * Plugin stop() 通过此接口安全调用实例清理方法，替代裸 `as any`。
 * 各方法均为可选：实例按需实现，Plugin 通过 optional chaining 安全调用。
 *
 * @since v3.1 — Plugin 化 stop() 类型安全收敛
 */
export interface Disposable {
  stop?: () => void;
  shutdown?: () => void;
  destroyAll?: () => void;
  clear?: () => void;
}

/** 返回类型声明——插件式注入类型 */
export type Unknown = unknown;

export type StrictNonEmptyArray<T> = T extends readonly [infer F, ...infer R] ? (F extends undefined ? never : readonly [F, ...R]) : never;

// ─── Span ID 前缀常量 ──────────────────────────────────────────

/** 任务执行流程 */
export const SPAN_PREFIX_TASK = "task-";
/** 配置变更流程 */
export const SPAN_PREFIX_CFG = "cfg-";
/** 场景切换流程 */
export const SPAN_PREFIX_SCENE = "scene-";
/** 启动流程 */
export const SPAN_PREFIX_BOOT = "boot-";
/** 系统流程 */
export const SPAN_PREFIX_SYS = "sys-";
