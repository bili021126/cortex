// ============================================================
// @cortex/scheduler —— 桶导出（Public API Surface）
//
// @module-convention
// 1. 凡 src/ 下新增公开符号，必须在本文件追加对应的 export 语句。
// 2. 测试文件禁止 ../ 相对导入——只用 @cortex/scheduler 包名导入。
//
// @since v0.1.0 — 从 @cortex/engine 独立拆出
// ============================================================

// ── 任务板 ─────────────────────────────────────
export { TaskBoard } from "./core/task-board.js";
export type { ITaskBoard } from "./core/task-board.js";

// ── Agent 池 ────────────────────────────────────
export { AgentPool } from "./core/agent-pool.js";
export type { ISchedulerAgentPool, IAgentPool } from "./core/agent-pool.js";

// ── 拓扑排序 ────────────────────────────────────
export { topologicalSort } from "./core/topological-sort.js";

// ── Agent 匹配 ──────────────────────────────────
export { findMatchingAgent, findAllMatchingAgents } from "./core/agent-matcher.js";

// ── 管线基础设施 ────────────────────────────────
export { PipelineObserver } from "./core/pipeline-observer.js";
export { PipelineRunner } from "./core/pipeline-runner.js";
export type { IStep, PipelineCtx } from "./core/pipeline-runner.js";

// ── 调度三抽象类型 ──────────────────────────────
export type {
  IScheduler,
  IScheduleStrategy,
  ILoopDriver,
  IExecutionModel,
  LoopContext,
  LoopResult,
  ExecutionContext,
  IModelRouter,
  ModelTier,
  CompositeSchedulerConfig,
} from "./core/scheduling-types.js";

// ── 调度三抽象——具体实现 ──────────────────────
export type { WaveDefinition, RouteDecision } from "./core/scheduling-implementations.js";
export {
  TagMatchingStrategy,
  RoundRobinStrategy,
  PriorityFirstStrategy,
  TopologicalLayeredDriver,
  SequentialDriver,
  WaveDriver,
  PipelineModel,
  SimpleExecuteModel,
  FixedModelRouter,
  SemanticModelRouter,
} from "./core/scheduling-implementations.js";

// ── 重规划管理 ──────────────────────────────────
export { ReplanManager } from "./core/replan-manager.js";
export type { IReplanProvider, ReplanItem } from "./core/replan-manager.js";

// ── RLM 递归拆解 ────────────────────────────────
export {
  decompose,
  shouldDecompose,
  shouldExecuteDecomposition,
  MAX_RLM_DEPTH,
  parseDecomposeResponse,
  buildDecomposePrompt,
} from "./core/rlm-decompose.js";
export type { LlmCallable } from "./core/rlm-decompose.js";

// ── 密度压缩 ────────────────────────────────────
export {
  parseDensityTag,
  stripDensityTag,
  compressByDensity,
  annotateAndCompress,
  mergeContext,
  densityToStrategy,
} from "./core/density-compress.js";

// ── 确认门 & 信任模型 ───────────────────────────
export { ConfirmGate } from "./core/confirm-gate.js";
export { TrustModel } from "./core/trust-model.js";

// ── 分发管线步骤 ────────────────────────────────
export { ClaimStep } from "./dispatch-steps/claim-step.js";
export { SpawnStep } from "./dispatch-steps/spawn-step.js";
export { ExecuteStep } from "./dispatch-steps/execute-step.js";
export { RlmExecuteStep } from "./dispatch-steps/rlm-execute-step.js";
export { CleanupStep } from "./dispatch-steps/cleanup-step.js";
export { BoundaryGuardStep, BOUNDARY_RULES } from "./dispatch-steps/boundary-guard-step.js";
export type { AgentBoundaryRule } from "./dispatch-steps/boundary-guard-step.js";
export { ManifoldGate } from "./dispatch-steps/manifold-gate.js";
export type { DispatchCtx, IDispatchStep } from "./dispatch-steps/types.js";

// ── 内部工具（测试环境检测） ─────────────────────
export { isTestEnv, ifNotTest } from "./utils/internal.js";
