// ============================================================
// @cortex/engine —— 桶导出（Public API Surface）
//
// @file-overview
// 本文档定义 @cortex/engine 包的外部契约端点。所有 export 均为
// 公共 API，其签名、语义、异常行为受契约保护。
//
// @contract 公共 API 稳定性承诺
// - 标记 @deprecated 的导出将在下个次版本移除（保留一个版本窗口）
// - 标记 @experimental 的导出（Core-2 预留）语义可能调整
// - 未标记的导出为稳定 API：新增字段不破坏、已有字段不改语义
//
// @version 2.1.0
// @governance 久岐忍 P1-3：外部端点缺少统一契约文档 → 已闭合
//
// @fix 久岐忍 P1-3：移除 export * 通配导出，改为显式逐条导出，
//   防止子模块无意识新增导出自动膨胀公开 API。
// ============================================================

// ── 工厂组件 ─────────────────────────────────────
export { createAgent, runReActLoop, extractSkillsFromOutput } from "./components/index.js";
export type { AgentFactoryConfig, ReActContext, SkillExtractResult } from "./components/index.js";

// ── Agent（全量：配置函数 / 旧类 / 实验性） ────────
export {
  // 配置函数（v2.1 组合式架构）
  codeAgentConfig, codeMemoryQuery, CodeSystemPrompt,
  reviewAgentConfig, reviewMemoryQuery, ReviewSystemPrompt,
  analysisAgentConfig, analysisMemoryQuery,
  opsAgentConfig, opsMemoryQuery, OpsSystemPrompt,
  loopAgentConfig, loopMemoryQuery, LoopSystemPrompt,
  docGovernAgentConfig, docGovernMemoryQuery, DocGovernSystemPrompt,
  apiAgentConfig, apiMemoryQuery, ApiSystemPrompt,
  dataAgentConfig, dataMemoryQuery, DataSystemPrompt,
  fixAgentConfig, fixMemoryQuery, FixSystemPrompt,
  // 复杂 Agent 创建函数
  createInspectorAgent, InspectorSystemPrompt,
  createBrowserAgent, BrowserSystemPrompt,
  ButlerAgent,
  // 特殊 Agent
  MetaAgent, StrategistAgent,
  // Core-2 实验性
  ApiAgent, DataAgent,
} from "./agents/index.js";

// ── 记忆子系统 ───────────────────────────────────
export {
  MemoryStore,
  executeWithMemoryPipeline,
  defaultMemoryQuery,
  makeMemoryQuery,
  MemoryStoreMonitor,
  registerSkillPipeline,
} from "./memory/index.js";
// MemoryWriteInput 已迁移至 @cortex/shared，重新导出以保持向后兼容
export type { MemoryWriteInput } from "@cortex/shared";

// ── 引擎核心 ─────────────────────────────────────
// @contract: Scheduler + TaskBoard + AgentPool + ConfirmGate + PipelineObserver
// 构成调度五元组。FileLockManager 提供文件锁。Toolkit 提供 Agent 工具注入。
// LlmAdapter（来自 @cortex/llm）提供 LLM 适配。CLIAdapter 提供 CLI 入口。
// MemoryStore 提供记忆中枢。
export { Scheduler, topologicalSort } from "./scheduler.js";
export { TaskBoard } from "./task-board.js";
export { AgentPool } from "./agent-pool.js";
export { ConfirmGate } from "./confirm-gate.js";
export { PipelineObserver } from "./pipeline-observer.js";
export { FileLockManager } from "./file-lock-manager.js";
export { Toolkit } from "./toolkit.js";
export { CLIAdapter } from "./cli-adapter.js";
export { NodeFileSystemAdapter } from "./node-fs-adapter.js";
export { ConsistencyLayer } from "./consistency/consistency-layer.js";
export { PoolAwareState } from "./pool-aware.js";
export { DocRegistry } from "./doc-registry.js";

// ── 技能注册表（从 @cortex/shared 移入本包） ──────
export { SkillRegistry } from "./skill-registry.js";

// ── 引擎配置 ───────────────────────────────────
export {
  type EngineConfig,
  DEFAULT_ENGINE_CONFIG,
  resolveConfig,
} from "./config.js";

// ── 修宪管线 ───────────────────────────────────
export { evaluateAmendment } from "./amendment-judge.js";
export { applyAmendment } from "./amendment-applier.js";
export {
  loadPendingProposals,
  saveProposal,
  updateProposalStatus,
  judgeProposals,
  applyApproved,
  summarizeGovernance,
} from "./governance-loop.js";
export type { BatchJudgment, GovernanceSummary } from "./governance-loop.js";

// ── LLM 适配 ─────────────────────────────────────
export { LlmAdapter } from "@cortex/llm";
