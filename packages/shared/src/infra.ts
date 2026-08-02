// ============================================================
// @cortex/shared — 基础设施类型域
// PipelineObserver、SafeErrorReporter、LLM 协议、Agent 接口
//
// 已拆出：toolkit.ts（工具+确认门+信任） / file-lock-manager.ts / cli-adapter.ts
// ============================================================

import type { AgentType } from "./agent.js";
import type { TaskNode, ExecutionReport, DensityLevel } from "./task.js";
import type { MemoryQuery, MemoryEntry, MemoryWriteInput, IMemoryStore } from "./memory.js";
import type { IConfirmGate } from "./toolkit.js";
import type { ITaskBoard, IAgentPool, IScheduler, IStrategistAgent } from "./scheduler-contracts.js";
import type { IMetaAgent } from "./tui-bridge.js";

// ─── PipelineObserver ──────────────────────────────────────

export enum PipelinePriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
}

/**
 * 事件类型枚举——封闭集合，镜像代码库中所有 emit 点。
 * 用枚举替代裸 string，编译期约束事件名拼写。
 * @since Core-2 — 接口固化，后续新增字段需向下兼容
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
  SkillToolPermissionDenied = "skill.tool_permission_denied",
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
  InteractConfigOverrideApplied = "interact.config_override_applied", // @reserved 声明先行，暂无生产者 — 2026-07
  InteractConfigReloaded = "interact.config_reloaded", // @reserved 声明先行，暂无生产者 — 2026-07
  InteractConfigSchemaViolation = "interact.config_schema_violation", // @reserved 声明先行，暂无生产者 — 2026-07
  // ── Mem（记忆流）──
  MemRetrievalStrategySelected = "mem.retrieval_strategy_selected", // @reserved 声明先行，暂无生产者 — 2026-07
  MemMemoryWarmupInitiated = "mem.memory_warmup_initiated", // @reserved 声明先行，暂无生产者 — 2026-07
  MemMemoryObliterationTriggered = "mem.memory_obliteration_triggered", // @reserved 声明先行，暂无生产者 — 2026-07
  MemMemoryWritten = "mem.memory_written",
  // ── Exec（执行流——调度器心跳/超时/生命周期）──
  ExecNodeDelayed = "exec.node_delayed",
  ExecLifecyclePhaseChanged = "exec.lifecycle_phase_changed",
  // ── Tele（遥测流）──
  TeleDegradationThresholdBreached = "tele.degradation_threshold_breached",
}

/**
 * 事件 Payload 类型联合——按事件类型锁定额外字段。
 * 不在枚举中的事件类型不会通过类型检查。
 * @since Core-2 — 接口固化，后续新增字段需向下兼容
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
  [PipelineEventType.SkillReferenced]: { nodeId: string; agentType: AgentType; skillId: string; skillName: string; stepsUsed?: number[]; stepsSkipped?: number[]; adaptation?: string };
  [PipelineEventType.SkillToolPermissionDenied]: { agentType: AgentType; toolName: string; reason: string };
  [PipelineEventType.AgentBoundaryViolation]: { nodeId: string; agentType: AgentType; violatingFiles: string[]; reason: string; expectedScope: string };
  // ── Governance ──
  [PipelineEventType.ConstitutionViolation]: GovernanceEventPayload & { rule: string; detail: string };
  [PipelineEventType.ConstitutionSessionConvened]: GovernanceEventPayload & { sessionId: string };
  [PipelineEventType.ConstitutionSessionResolved]: GovernanceEventPayload & { sessionId: string; resolution: string };
  [PipelineEventType.GovernanceAmendmentProposed]: GovernanceEventPayload & { amendmentId: string };
  [PipelineEventType.GovernanceAuditReport]: GovernanceEventPayload & { auditType: "plan_review" | "doc_audit" | "constitution_check" };
  [PipelineEventType.GovernanceComplianceViolation]: GovernanceEventPayload & { violationLevel: "P0" | "P1" | "P2" | "P3" };
  [PipelineEventType.GovernanceRoundtableConsensus]: GovernanceEventPayload & { participants: string[] };
  // ── RLM（递归分层执行）──
  [PipelineEventType.RlmDecompose]: { nodeId: string; subTaskCount: number; depth: number; confidence: number; rationale: string };
  [PipelineEventType.RlmContextCompress]: { nodeId: string; density: DensityLevel; originalLength: number; compressedLength: number };
  // ── ManifoldGate（流控）──
  [PipelineEventType.ManifoldGateWaitStart]: { agentType: string; queuePosition: number; active: number; max: number; requestId: string };
  [PipelineEventType.ManifoldGateWaitEnd]: { agentType: string; remainingWaiters: number; requestId: string };
  [PipelineEventType.ManifoldGateAcquireTimeout]: { agentType: string; timeoutMs: number; requestId: string };
  [PipelineEventType.ManifoldGateReleased]: { agentType: string; active: number; waiting: number; requestId: string };
  [PipelineEventType.ManifoldGateInvariantViolation]: { agentType: string; message: string };
  [PipelineEventType.ManifoldGateReleaseOrphan]: { agentType: string; message: string };
  [PipelineEventType.ManifoldGateMaxUpdated]: { agentType: string; newMax: number; woken: number; remainingWaiters: number };
  // ── Infra（基础设施）──
  [PipelineEventType.InfraFileLockExpiredReclaimed]: { count: number; path: string; holders: string; detail: string };
  [PipelineEventType.InfraComponentDegraded]: { operation?: string; detail?: string; nodeId?: string; component?: string; source?: string; message?: string; level?: string };
  // ── Interact（配置交互流）──
  [PipelineEventType.InteractConfigOverrideApplied]: { timestamp: number; key: string; source: 'env' | 'user' | 'project'; oldValue: unknown; newValue: unknown }; // @reserved 声明先行，暂无生产者 — 2026-07
  [PipelineEventType.InteractConfigReloaded]: { timestamp: number; watchPath: string; changedKeys: string[] }; // @reserved 声明先行，暂无生产者 — 2026-07
  [PipelineEventType.InteractConfigSchemaViolation]: { timestamp: number; schemaName: string; errors: { path: string; message: string }[] }; // @reserved 声明先行，暂无生产者 — 2026-07
  // ── Mem（记忆流）──
  [PipelineEventType.MemRetrievalStrategySelected]: { timestamp: number; query: string; strategy: string; reason: string }; // @reserved 声明先行，暂无生产者 — 2026-07
  [PipelineEventType.MemMemoryWarmupInitiated]: { timestamp: number; embeddingModel: string; dimension: number }; // @reserved 声明先行，暂无生产者 — 2026-07
  [PipelineEventType.MemMemoryObliterationTriggered]: { timestamp: number; pattern: string; reason: string }; // @reserved 声明先行，暂无生产者 — 2026-07
  [PipelineEventType.MemMemoryWritten]: { entryId: string; domain?: string; scene?: string; byteSize: number };
  // ── Exec（执行流——调度器心跳/超时/生命周期）──
  [PipelineEventType.ExecNodeDelayed]: { nodeId: string; agentId: string; elapsed: number; action: 'wait' | 'extend'; level: 'warn' | 'ping' };
  [PipelineEventType.ExecLifecyclePhaseChanged]: { from: "uninitialized" | "running" | "shutdown"; to: "uninitialized" | "running" | "shutdown"; phase: "bootstrap_done" | "shutdown_start" | "shutdown_done" | "component_error"; component?: string; error?: string };
  // ── Tele（遥测流）──
  [PipelineEventType.TeleDegradationThresholdBreached]: { timestamp: number; source: string; count: number; threshold: number };
};

/**
 * 治理事件统一上下文。
 * 所有治理组件 emit 的 ObservableEvent 中，payload 应符合此结构。
 */
export interface GovernanceEventPayload {
  /** 事件严重性（可选——由事件类型/通知通道派生，消费方可选读取） */
  severity?: "FYI" | "WARNING" | "DECISION_REQUIRED";
  /** 发射源（可选——2026-06-20 类型债专项：实际用法允许省略，消费方按需读取） */
  source?: "doc-govern" | "sentinel" | "confirm-gate" | "committee" | "strategist" | "governance-loop" | "rule-denied";
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

/**
 * 类型化 ObservableEvent——type 必须是枚举成员，payload 按 type 锁定
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

/**
 * 可辨识联合形态的 ObservableEvent——对每个 PipelineEventType 实例化。
 * 与 ObservableEvent<T>（宽泛型标注）不同：EmittableEvent 是「联合」，
 * 用 type 字段做辨识收窄，使 emit() 的字面量入参在编译期锁定 payload 形状。
 * 这是根治「payload 与 type 不匹配」漂移的类型闸门。
 */
export type EmittableEvent = {
  [K in PipelineEventType]: ObservableEvent<K>;
}[PipelineEventType];

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
  emit(event: EmittableEvent, meta?: EmitMeta): void;
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
  /** R6-H2 fix: SSE 流中断标记——调用方据此决定是否重试 */
  degraded?: boolean;
}

export interface LlmUsage {
  prompt_tokens: number;
  completion_tokens: number;
  /** DeepSeek V4 上下文缓存命中的 prompt token 数（成本约为 miss 的 1/10） */
  prompt_cache_hit_tokens?: number;
  /** DeepSeek V4 未命中缓存、按全价计费的 prompt token 数 */
  prompt_cache_miss_tokens?: number;
}

/** LLM function calling 工具定义（OpenAI 兼容格式） */
export interface ToolDef {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

/**
 * DeepSeek V4 reasoning_effort 七级梯度。
 * 对齐 DeepSeek V4 API 2026H1 规格：off → minimal → low → medium → high → xhigh → max
 */
export type ReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * 模型能力声明——替代脆弱的 model.includes("pro") 字符串匹配。
 * 由 models.json 注册表驱动，运行时通过 resolveModelCapabilities() 查询。
 */
export interface ModelCapabilities {
  /** 是否支持 thinking/reasoning 模式 */
  thinking: boolean;
  /** 是否支持 function calling */
  functionCalling: boolean;
  /** 是否支持流式输出 */
  streaming: boolean;
  /** 最大输出 token 数（DeepSeek V4 Pro: 384K, Flash: 64K） */
  maxOutputTokens: number;
  /** 上下文窗口大小（DeepSeek V4: 1M tokens） */
  contextWindow: number;
  /** Flash→Pro 降级目标模型 ID。缺省则不降级。 */
  degradesTo?: string;
  /** 是否支持 tool_choice 参数（Pro 支持，Flash 不支持）。未声明时保守=false。 */
  supportsToolChoice?: boolean;
}

/** LLM 适配器配置——DeepSeek V4 全面对齐 */
export interface LlmAdapterConfig {
  baseUrl: string;
  apiKey: string;
  chatModel?: string;
  reasonerModel?: string;
  /** DeepSeek V4 七级 reasoning_effort（替代旧版仅 high/max 二选一） */
  reasoningEffort?: ReasoningEffort;
  /** 权限控制标识（用于限流/配额匹配，如 "cyrene" / "chat" / "reasoner"） */
  label?: string;
  /** 供应商扩展参数（如 DeepSeek 的 thinking 模式等）。调用方显式设置，无默认值。 */
  extraBody?: Record<string, unknown>;
  /** 最大输出 token 数。默认 65536，DeepSeek V4 Pro 支持 384K (393216) */
  maxTokens?: number;
  /** 采样温度。DeepSeek V4 推荐 0.0-1.0，默认 0.0（确定性输出） */
  temperature?: number;
  /** 频率惩罚 -2.0 ~ 2.0。降低重复 token 概率 */
  frequencyPenalty?: number;
  /** 存在惩罚 -2.0 ~ 2.0。鼓励话题多样性 */
  presencePenalty?: number;
  /** 模型能力声明——由注册表注入，替代字符串匹配推断 */
  capabilities?: ModelCapabilities;
}

// ─── 运行时类型约束 ──────────────────────────────────────────

// ─── CLI ↔ 引擎统一通信接口 ─────────────────────────────

/** 对话选项 */
export interface ChatOptions {
  model?: string;
  /** DeepSeek V4 七级 reasoning_effort */
  reasoningEffort?: ReasoningEffort;
}

/** 生命周期管理
 * @since Core-2 — ICortexApi 拆分为5域接口。新消费方优先使用此接口。 */
export interface ICortexLifecycle {
  readonly ready: boolean;
  readonly bootstrapped: boolean;
  ensureReady(): Promise<void>;
  ensureBootstrapped(): Promise<void>;
  shutdown(): Promise<void>;
}

/** 对话能力
 * @since Core-2 — ICortexApi 拆分为5域接口。新消费方优先使用此接口。 */
export interface ICortexChat {
  chat(systemPrompt: string, messages: LlmMessage[], opts?: ChatOptions): Promise<string>;
  getChatModelName(): string;
  getReasonerModelName(): string;
}

/** 任务执行
 * @since Core-2 — ICortexApi 拆分为5域接口。新消费方优先使用此接口。 */
export interface ICortexTask {
  submitTask(node: TaskNode): Promise<void>;
  executeAll(): Promise<ExecutionReport>;
}

/** Talk 记忆 / 主记忆库
 * @since Core-2 — ICortexApi 拆分为5域接口。新消费方优先使用此接口。 */
export interface ICortexMemory {
  ensureTalkMemory(): Promise<void>;
  readTalkMemory(query: MemoryQuery): Promise<MemoryEntry[]>;
  writeTalkMemory(entry: MemoryWriteInput): Promise<void>;
  readMainMemory(query: MemoryQuery): Promise<MemoryEntry[]>;
}

/** 引擎组件访问
 * @since Core-2 — ICortexApi 拆分为5域接口。新消费方优先使用此接口。
 * @since Core-2.5 — unknown 收敛为具名契约（ITaskBoard/IAgentPool/IScheduler/IStrategistAgent/IMetaAgent） */
export interface ICortexComponents {
  getMetaAgent(): Promise<IMetaAgent | undefined>;
  getStrategists(): Map<string, IStrategistAgent> | undefined;
  getConfirmGate(): Promise<IConfirmGate>;
  getMemoryStore(): Promise<IMemoryStore>;
  getTaskBoard(): Promise<ITaskBoard>;
  getScheduler(): Promise<IScheduler>;
  getAgentPool(): IAgentPool | undefined;
}

/**
 * @since Core-2 — 拆分为5个域接口。ICortexApi 保留作为组合兼容面。新增消费方优先使用子接口。
 */
export interface ICortexApi extends ICortexLifecycle, ICortexChat, ICortexTask, ICortexMemory, ICortexComponents {}

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
  dispose?: () => void;
}

/** 返回类型声明——插件式注入类型 */

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
