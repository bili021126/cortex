// ============================================================
// @cortex/engine —— 桶导出（Public API Surface）
//
// @module-convention 模块化铁律（昔涟 v2.6 入宪）
// 1. 凡 src/ 下新增公开符号，必须在本文件追加对应的 export 语句。
// 2. 测试文件禁止 ../src/ 相对导入——只用 @cortex/<package> 包名导入。
// 3. 新增子模块同步更新。
//
// @contract 公共 API 稳定性承诺
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
export { MetaAgent, StrategistAgent, type IntentClarification } from "./agents/index.js";

// ── 记忆子系统（仅引擎胶水层） ──────────────────
export { executeWithMemoryPipeline, defaultMemoryQuery, makeMemoryQuery, resolvePipeline, DirectStep, DEFAULT_PIPELINE, DIRECT_PIPELINE, registerSkillPipeline, emitSkillReferenced, extractSkillUsageFromOutput } from "./memory/index.js";

// ── Bootstrap 集成入口 ──────────────────────────
export { bootstrapEngine, resolveLlm } from "./bootstrap/bootstrap-engine.js";
export type { BootstrapEngineOptions, BootstrapEngineResult } from "./bootstrap/bootstrap-engine.js";

// ── 引擎核心 ──────────────────────────────
// @note v3.x stable — 调度/平台/配置/LLM 类型请直接从对应包导入，engine barrel 不再重导出
export { BaseAgent } from "./base-agent.js";
export { Scheduler } from "./core/scheduler.js";
export { MetaAgentReplanAdapter } from "./core/meta-agent-adapter.js";

// ── 一致性层（六层防御） ─────────────────────────
// @note v2.6.7 兼容层已砍，直接导入 @cortex/consistency

// ── 引擎组件 ────────────────────────────────────
export { PoolAwareState } from "./components/pool-aware.js";
export { DocRegistry } from "./registry/doc-registry.js";

// ── 搜索后端 ───────────────────────────────────
// @note v2.6.7 兼容层已砍，直接导入 @cortex/platform

// ── 技能系统 ────────────────────────────────────
export { SkillRegistry, deriveStatus } from "./registry/skill-registry.js";

// ── Core-2: 引擎遥测 ───────────────────────────
export { getTelemetry, setTelemetry, recordTelemetry, shutdownTelemetry } from "./telemetry/engine-telemetry.js";

// ── v3.1 生命周期 & 优雅关闭 ─────────────────
export { LifecycleManager } from "./lifecycle/lifecycle-manager.js";
export { ShutdownWarden } from "./core/shutdown-warden.js";
export type { ShutdownReport } from "./core/shutdown-warden.js";

// ── v3.1 文件锁管理器 ────────────────────────
export { FileLockManager } from "./core/file-lock-manager.js";

// ── v3.1 Console → Observer 桥接 ─────────────
export { installConsoleBridge, uninstallConsoleBridge } from "./observer/console-bridge.js";

// ── 引擎配置 ───────────────────────────────────
// @note 配置类型、常量、默认值统一由 @cortex/config 提供
// engine barrel 不再重导出——调用方请直接从 @cortex/config 导入
export {
  DEFAULT_LOCK_TIMEOUT_MS,
  CLEANUP_INTERVAL_MS,
  SHUTDOWN_TIMEOUT_MS,
  SHUTDOWN_FORCE_EXIT_DELAY_MS,
  SCHEDULER_MAX_ROUNDS,
  SCHEDULER_ROUND_TIMEOUT_MS,
  REACT_MAX_LOOPS,
  EMBEDDING_DIM,
  EMBEDDING_CACHE_SIZE,
  CONTENT_HASH_ALGO,
  VECTOR_DEDUP_THRESHOLD,
  WEIGHT_AGING_FACTOR,
  STALE_FREEZE_DAYS,
  FROZEN_OBLITERATE_DAYS,
  MAINTENANCE_WEIGHT_THRESHOLD,
  MAX_TOTAL_MEMORIES,
  SCHEMA_VERSION,
  MONITOR_WINDOW_MS,
  MONITOR_THRESHOLD,
  ENGINE_DEFAULTS,
  loadEngineDefaults,
} from "./config/engine-defaults.js";
export type { EngineDefaults } from "./config/engine-defaults.js";

// ── 修宪管线 ───────────────────────────────────
// @note v2.6.7 兼容层已砍，直接导入 @cortex/governance

// ── LLM 适配 ─────────────────────────────────────
// @note LlmAdapter 由 @cortex/llm 提供，engine barrel 不再重导出
// CLI/外部消费者请直接从 @cortex/llm 导入

// ── v3.1 调度层兼容重导出（引擎测试需要） ──────
// @note 调度核心类请从 @cortex/scheduler 导入；
// engine barrel 保留重导出以兼容现有测试。
export { TaskBoard } from "@cortex/scheduler";
export { AgentPool } from "@cortex/scheduler";
export { PipelineObserver } from "@cortex/scheduler";
export { PipelineRunner } from "@cortex/scheduler";
export { topologicalSort } from "@cortex/scheduler";
export { TrustModel } from "@cortex/scheduler";
export { ConfirmGate } from "@cortex/scheduler";
export { ManifoldGate } from "@cortex/scheduler";
export {
  decompose,
  shouldDecompose,
  shouldExecuteDecomposition,
  MAX_RLM_DEPTH,
  parseDecomposeResponse,
  buildDecomposePrompt,
} from "@cortex/scheduler";
export type { PipelineCtx, IStep } from "@cortex/scheduler";

// ── v3.1 密度压缩兼容重导出（引擎测试需要） ──
export {
  parseDensityTag,
  stripDensityTag,
  compressByDensity,
  annotateAndCompress,
  mergeContext,
  densityToStrategy,
} from "@cortex/scheduler";

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
