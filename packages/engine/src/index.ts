// ============================================================
// @cortex/engine —— 桶导出（Public API Surface）
//
// @module-convention 模块化铁律（昔涟 v2.6 入宪）
// 1. 凡 src/ 下新增公开符号，必须在本文件追加对应的 export 语句。
// 2. 测试文件禁止 ../src/ 相对导入——只用 @cortex/<package> 包名导入。
// 3. 新增子模块同步更新。
//
// @contract 公共 API 稳定性承诺
// - 标记 @deprecated 的导出将在下个次版本移除
// - 标记 @experimental 的导出（Core-2 预留）语义可能调整
// - 未标记的导出为稳定 API
//
// @refactor v2.2 — Agent 导出改由 registry.ts 统一管理，按 domain 聚类标注。
// @version 2.2.0
// ============================================================

// ── 工厂组件 ─────────────────────────────────────
export { createAgent, runReActLoop, extractSkillsFromOutput, scanOutputFilesForSkills, persistSkillsToMemory, loadSkillsFromMemory, crystallizeSkillToKnowledge, verifySkillKnowledge, searchExternalEvidence, validateExternalSkillJson, externalJsonToSkillTemplate, importExternalSkill, SkillTemplateEngine } from "./components/index.js";
export type { AgentFactoryConfig, ReActContext, SkillExtractResult, CrystallizeOptions, CrystallizeResult, KnowledgeMetadata, ExternalSearcher, VerifyOptions, VerifyResult, SkillJsonValidationResult, SkillJsonValidationError, SkillJsonValidationWarning, SkillJsonValidationInfo, SkillJsonValidator, SkillStatus, TemplateEngineOptions, TemplateContext } from "./components/index.js";

// ── Agent（registry 统一导出 + 特殊／实验性 Agent） ──
// 配置函数 & 记忆查询（9 Agent）→ 来自 registry.ts
export {
  codeAgentConfig, codeMemoryQuery, reviewAgentConfig, reviewMemoryQuery,
  analysisAgentConfig, analysisMemoryQuery, opsAgentConfig, opsMemoryQuery,
  loopAgentConfig, loopMemoryQuery, docGovernAgentConfig, docGovernMemoryQuery,
  apiAgentConfig, apiMemoryQuery, dataAgentConfig, dataMemoryQuery,
  fixAgentConfig, fixMemoryQuery,
} from "./agents/registry.js";
// 复杂 Agent 创建
export { createInspectorAgent, createBrowserAgent, ButlerAgent } from "./agents/index.js";
// 特殊 Agent & Core-2 实验性
export { MetaAgent, StrategistAgent, ApiAgent, DataAgent, type IntentClarification } from "./agents/index.js";

// ── 记忆子系统 ───────────────────────────────────
export {
  MemoryStore, executeWithMemoryPipeline, defaultMemoryQuery, makeMemoryQuery,
  resolvePipeline, DirectStep, DEFAULT_PIPELINE, DIRECT_PIPELINE,
  MemoryStoreMonitor, registerSkillPipeline,
  embedText, embedBatch, isModelLoaded, defaultEmbeddingService,
  ContextBuilder,
} from "./memory/index.js";
export type { IMemoryStore, MaintainReport, IEmbeddingService, ContextBuildResult } from "./memory/index.js";

// ── Bootstrap 集成入口 ──────────────────────────
export { bootstrapEngine, resolveLlm } from "./bootstrap/bootstrap-engine.js";
export type { BootstrapEngineOptions, BootstrapEngineResult } from "./bootstrap/bootstrap-engine.js";

// ── 引擎核心（调度五元组 + 基础设施） ──────────
export { BaseAgent } from "./base-agent.js";
export { Scheduler } from "./core/scheduler.js";
export type { IScheduler } from "./core/scheduler.js";
export { topologicalSort } from "./core/topological-sort.js";
export { TaskBoard } from "./core/task-board.js";
export type { ITaskBoard } from "./core/task-board.js";
export { AgentPool } from "./core/agent-pool.js";
export type { ISchedulerAgentPool, IAgentPool } from "./core/agent-pool.js";
export { ConfirmGate } from "./core/confirm-gate.js";
export { PipelineObserver } from "./core/pipeline-observer.js";
export { PipelineRunner } from "./core/pipeline-runner.js";
export type { IStep, PipelineCtx } from "./core/pipeline-runner.js";
export { findMatchingAgent, findAllMatchingAgents } from "./core/agent-matcher.js";
export { ReplanManager } from "./core/replan-manager.js";
export type { ReplanItem } from "./core/replan-manager.js";
export { ClaimStep } from "./core/dispatch-steps/claim-step.js";
export { SpawnStep } from "./core/dispatch-steps/spawn-step.js";
export { ExecuteStep } from "./core/dispatch-steps/execute-step.js";
export { RlmExecuteStep } from "./core/dispatch-steps/rlm-execute-step.js";
export { CleanupStep } from "./core/dispatch-steps/cleanup-step.js";
export { BoundaryGuardStep, BOUNDARY_RULES } from "./core/dispatch-steps/boundary-guard-step.js";
export type { AgentBoundaryRule } from "./core/dispatch-steps/boundary-guard-step.js";
export type { DispatchCtx, IDispatchStep } from "./core/dispatch-steps/types.js";

// ── RLM 递归拆解 + DENSITY 密度压缩（思考执行体系总纲 §四/§六）──
export { decompose, shouldDecompose, shouldExecuteDecomposition, MAX_RLM_DEPTH, parseDecomposeResponse, buildDecomposePrompt } from "./core/rlm-decompose.js";
export type { LlmCallable } from "./core/rlm-decompose.js";
export { parseDensityTag, stripDensityTag, compressByDensity, annotateAndCompress, mergeContext, densityToStrategy } from "./core/density-compress.js";
export { FileLockManager } from "./platform/file-lock-manager.js";
export { Toolkit } from "./platform/toolkit.js";
export { CLIAdapter } from "./platform/cli-adapter.js";
export { NodeFileSystemAdapter } from "./platform/node-fs-adapter.js";
export { validatePath, resolveSafePath } from "./platform/path-utils.js";
export type { PathValidationResult } from "./platform/path-utils.js";

// ── 组合式调度器（v2.9 三抽象可组合调度） ──────
export { CompositeScheduler } from "./core/composite-scheduler.js";
export {
  TagMatchingStrategy,
  RoundRobinStrategy,
  PriorityFirstStrategy,
  TopologicalLayeredDriver,
  SequentialDriver,
  WaveDriver,
  PipelineModel,
  SimpleExecuteModel,
} from "./core/scheduling-implementations.js";
export type {
  IScheduleStrategy,
  ILoopDriver,
  IExecutionModel,
  LoopContext,
  LoopResult,
  ExecutionContext,
  CompositeSchedulerConfig,
} from "./core/scheduling-types.js";

// ── 一致性层（六层防御） ─────────────────────────
export { ConsistencyLayer } from "./consistency/consistency-layer.js";
export { IntentFactWall } from "./consistency/intent-fact-wall.js";
export { SchemaEnforcer } from "./consistency/schema-enforcer.js";
export type { ValidationResult } from "./consistency/schema-enforcer.js";
export { InitVerifier, extractFileReferences } from "./consistency/init-verifier.js";
export type { ConsistencyReport, VerificationEntry } from "./consistency/init-verifier.js";

export { PoolAwareState } from "./components/pool-aware.js";
export { DocRegistry } from "./registry/doc-registry.js";

// ── 搜索后端 ───────────────────────────────────
export { SearchAggregator } from "./platform/search-aggregator.js";
export { McpSearchBackend, DdgSearchBackend } from "./platform/search-backend.js";
export type { SearchBackend, SearchResult } from "./platform/search-backend.js";
export { compressContent, extractFindings, compressForRoundtable } from "./platform/context-compressor.js";
export type { CompressionLevel, CompressedReport, ReportStats, RoundtableCompressInput } from "./platform/context-compressor.js";
export { McpClient, McpToolAdapter, MCP_PREFIX } from "./platform/mcp-client.js";
export type { McpServerConfig, McpToolDef } from "./platform/mcp-client.js";
export { LocalTool } from "./platform/local-tool.js";

// ── 技能系统 ────────────────────────────────────
export { SkillRegistry, deriveStatus } from "./registry/skill-registry.js";

// ── Core-2: 引擎遥测 ───────────────────────────
export { getTelemetry, setTelemetry, recordTelemetry, shutdownTelemetry } from "./telemetry/engine-telemetry.js";

// ── 引擎配置 ───────────────────────────────────
// @note 配置类型、常量、默认值统一由 @cortex/config 提供。
// engine barrel 不再重导出——调用方请直接从 @cortex/config 导入。
export type {
  EngineConfig, SearchProviderConfig, SearchAggregationConfig, SearchConfig,
  ToolTimeoutsConfig, InspectorConfig, LlmConfig, FilePathsConfig, SkillSystemConfig,
} from "@cortex/config";
export {
  DEFAULT_ENGINE_CONFIG, resolveConfig,
} from "@cortex/config";

// ── 修宪管线 ───────────────────────────────────
export { evaluateAmendment, registerAmendmentCheck, unregisterAmendmentCheck, getAmendmentChecks } from "./governance/amendment-judge.js";
export type { AmendmentCheckFn, CheckRegistration } from "./governance/amendment-judge.js";
export { applyAmendment, findConstitutionPath } from "./governance/amendment-applier.js";
export {
  loadPendingProposals, saveProposal, updateProposalStatus,
  judgeProposals, applyApproved, summarizeGovernance, checkTimeouts,
} from "./governance/governance-loop.js";
export type { BatchJudgment, GovernanceSummary } from "./governance/governance-loop.js";
export {
  runPipeline, previewPipeline, registerStage, unregisterStage, getRegisteredStages,
} from "./governance/governance-pipeline.js";
export type {
  PipelineStageId, StageResult, StageFn, PipelineContext,
  PipelineConfig, PipelineResult,
} from "./governance/governance-pipeline.js";
export { checkTimeout, updateStaleCount } from "./governance/amendment-timeout.js";
export type { TimeoutAction, TimeoutConfig } from "./governance/amendment-timeout.js";

// ── LLM 适配 ─────────────────────────────────────
// @note LlmAdapter 由 @cortex/engine 重导出：engine 作为 llm 的消费封装层，
// 对 CLI/外部消费者提供统一入口，避免调用方同时依赖 @cortex/llm。
export { LlmAdapter } from "@cortex/llm";

// ── 插件体系（v3.1 配置驱动）────────────────────
export { PluginLoader, type EnginePluginLoadConfig } from "./plugin/plugin-loader.js";
export { registerAgentFactory, getAgentFactory, hasAgentFactory, getRegisteredAgentTypes } from "./plugin/register-all.js";
export type { EnginePlugin, PluginContext, PluginContainer, PluginExternals, PluginHealth } from "./plugin/types.js";
export type { AgentFactory } from "./plugin/agent-factory-registry.js";

// ── 插件实例（供测试/扩展直接引用）───────────────
export { PipelineObserverPlugin } from "./plugin/pipeline-observer.plugin.js";
export { TaskBoardPlugin } from "./plugin/task-board.plugin.js";
export { AgentPoolPlugin } from "./plugin/agent-pool.plugin.js";
export { ConfirmGatePlugin } from "./plugin/confirm-gate.plugin.js";
export { MemoryStorePlugin } from "./plugin/memory-store.plugin.js";
export { ConsistencyLayerPlugin } from "./plugin/consistency-layer.plugin.js";
export { MetaAgentPlugin } from "./plugin/meta-agent.plugin.js";
export { GovernancePlugin } from "./plugin/governance.plugin.js";
export { SchedulerPlugin } from "./plugin/scheduler.plugin.js";
