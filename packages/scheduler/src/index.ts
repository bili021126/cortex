// ============================================================
// @cortex/scheduler —— 桶导出（Public API Surface）
//
// 【Public API】
//   本文件导出的四抽象接口/实现为调度层的公开契约：
//   · TaskBoard / AgentPool — 任务板与 Agent 池
//   · PipelineObserver — 事件总线
//   · IScheduleStrategy / ILoopDriver / IExecutionModel / IModelRouter — 四抽象
//   · CompositeScheduler — 组合调度入口
//   其余为 Internal 实现——外部消费者不应直接依赖。
//
// 【Internal — 不从 scheduler 导入】
//   dispatch-steps/ — 每个 step 的具体实现
//   task-router.ts — 内部任务路由
//   scheduling-types.ts — 内部调度类型
//   以上由 CompositeScheduler 内部组合，外部不直接使用。

// ── 任务板 ──────────────────────────────────────────────────────
export { TaskBoard } from "./core/task-board.js";
export type { ITaskBoard } from "./core/task-board.js";

// ── Agent 池 ────────────────────────────────────────────────────
export { AgentPool } from "./core/agent-pool.js";
export type { ISchedulerAgentPool, IAgentPool } from "./core/agent-pool.js";

// ── 拓扑排序 ────────────────────────────────────────────────────
export { topologicalSort } from "./core/topological-sort.js";

// ── Agent 匹配 ──────────────────────────────────────────────────
export { findMatchingAgent, findAllMatchingAgents } from "./core/agent-matcher.js";

// ── 流水线观察 & 运行 ───────────────────────────────────────────
export { PipelineObserver } from "./core/pipeline-observer.js";
export { PipelineRunner } from "./core/pipeline-runner.js";
export type { IStep, PipelineCtx } from "./core/pipeline-runner.js";

// ── 调度四抽象——类型定义 ────────────────────────────────────────
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

// ── 调度四抽象——具体实现 ────────────────────────────────────────
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

// ── 重规划管理 ──────────────────────────────────────────────────
export { ReplanManager } from "./core/replan-manager.js";
export type { IReplanProvider, ReplanItem } from "./core/replan-manager.js";

// ── RLM 递归拆解 ────────────────────────────────────────────────
export {
  decompose,
  shouldDecompose,
  shouldExecuteDecomposition,
  MAX_RLM_DEPTH,
  parseDecomposeResponse,
  buildDecomposePrompt,
} from "./core/rlm-decompose.js";
export type { LlmCallable } from "./core/rlm-decompose.js";

// ── 密度压缩 ────────────────────────────────────────────────────
export {
  parseDensityTag,
  stripDensityTag,
  compressByDensity,
  annotateAndCompress,
  mergeContext,
  densityToStrategy,
} from "./core/density-compress.js";

// ── 确认门 & 信任模型 ───────────────────────────────────────────
export { ConfirmGate } from "./core/confirm-gate.js";
export { TrustModel } from "./core/trust-model.js";

// ── 调度步骤实现 ────────────────────────────────────────────────
export { ClaimStep } from "./dispatch-steps/claim-step.js";
export { SpawnStep } from "./dispatch-steps/spawn-step.js";
export { ExecuteStep } from "./dispatch-steps/execute-step.js";
export { RlmExecuteStep } from "./dispatch-steps/rlm-execute-step.js";
export { CleanupStep } from "./dispatch-steps/cleanup-step.js";
export { BoundaryGuardStep, BOUNDARY_RULES } from "./dispatch-steps/boundary-guard-step.js";
export type { AgentBoundaryRule } from "./dispatch-steps/boundary-guard-step.js";
export { ManifoldGate } from "./dispatch-steps/manifold-gate.js";
export type { DispatchCtx, IDispatchStep } from "./dispatch-steps/types.js";

// ── 仅测试环境内部使用 ──────────────────────────────────────────
export { isTestEnv, ifNotTest } from "./utils/internal.js";
