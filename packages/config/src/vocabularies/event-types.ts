// ============================================================
// @cortex/config — 事件类型域（从 @cortex/shared 迁入）
//
// PipelineEventType / EventPayloadMap —— 可观测事件管道的事件枚举与类型锁定额外字段。
// ============================================================

import type { AgentType } from "./agent-enums.js";

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
  InteractConfigOverrideApplied = "interact.config_override_applied",
  InteractConfigReloaded = "interact.config_reloaded",
  InteractConfigSchemaViolation = "interact.config_schema_violation",

  // ── Mem（记忆流）──
  MemRetrievalStrategySelected = "mem.retrieval_strategy_selected",
  MemMemoryWarmupInitiated = "mem.memory_warmup_initiated",
  MemMemoryObliterationTriggered = "mem.memory_obliteration_triggered",
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
  [PipelineEventType.SkillToolPermissionDenied]: {
    agentType: AgentType;
    toolName: string;
    reason: string;
  };
  [PipelineEventType.AgentBoundaryViolation]: {
    nodeId: string;
    agentType: AgentType;
    violatingFiles: string[];
    reason: string;
    expectedScope: string;
  };
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
  [PipelineEventType.MemMemoryWritten]: {
    entryId: string;
    domain?: string;
    /** 记忆域场景 */
    scene?: string;
    /** 字节大小 */
    byteSize: number;
  };

  // ── Exec（执行流——调度器心跳/超时/生命周期）──
  [PipelineEventType.ExecNodeDelayed]: {
    nodeId: string;
    agentId: string;
    elapsed: number;
    action: 'wait' | 'extend';
    level: 'warn' | 'ping';
  };
  [PipelineEventType.ExecLifecyclePhaseChanged]: {
    from: "uninitialized" | "running" | "shutdown";
    to: "uninitialized" | "running" | "shutdown";
    phase: "bootstrap_done" | "shutdown_start" | "shutdown_done" | "component_error";
    component?: string;
    error?: string;
  };

  // ── Tele（遥测流）──
  [PipelineEventType.TeleDegradationThresholdBreached]: { timestamp: number; source: string; count: number; threshold: number };
};

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
