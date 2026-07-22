// ============================================================
// @cortex/engine —— 桶导出（Public API Surface）
//
// 【Public API】
//   本文件导出的所有符号均为 @cortex/engine 的公开 API。
//   @experimental 标记的导出可能调整，其余为稳定 API。
//
// 【Internal — 不从 engine 导入】
//   @cortex/config         → 所有配置常量/类型
//   @cortex/scheduler      → 所有调度类/类型
//   @cortex/telemetry      → 所有遥测函数/类型
//   @cortex/governance     → 所有治理类/类型
//   @cortex/skill-kit      → 所有技能类/类型
//   @cortex/plugin-runner  → 所有插件类/类型
//   @cortex/llm            → LlmAdapter
//   以上符号已从 engine barrel 移除——请从源包直接导入
//
// @module-convention 模块化铁律（昔涟 v2.6 入宪）
// 1. 凡 src/ 下新增公开符号，必须在本文件追加对应的 export 语句。
// 2. 测试文件禁止 ../src/ 相对导入——只用 @cortex/<package> 包名导入。
//
// @refactor v2.2 — Agent 导出改由 registry.ts 统一管理，按 domain 聚类标注。
// @version 2.2.0
// ============================================================

// ── 工厂组件 ─────────────────────────────────────
export { createAgent, runReActLoop, extractSkillsFromOutput, persistSkillsToMemory, loadSkillsFromMemory, crystallizeSkillToKnowledge, verifySkillKnowledge, searchExternalEvidence, validateExternalSkillJson, externalJsonToSkillTemplate, importExternalSkill, SkillTemplateEngine } from "./components/index.js";
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

// ── Core-2: 烟绯确认门 Agent ──────────────────────
// @experimental 信任分计算 + 自动放行决策
// @yanfei confirm-gate-agent — trust score computation & auto-approval
export { createConfirmGateAgent, computeTrustScore, shouldAutoApprove } from "./agents/confirm-gate-agent.js";
export type { TrustRecord, TrustScore } from "./agents/confirm-gate-agent.js";

// ── Core-2: Prompt 管理 ────────────────────────
// @experimental prompt-kit 引擎集成层
export { PromptManager } from "./core/prompt-manager.js";
export type { PlanningPromptBlocks } from "./core/prompt-manager.js";

// ── Core-2: 循环策略注册表 ─────────────────────
// @experimental 可插拔循环策略（react/direct/decompose/jury）
export { LoopStrategyRegistry, loopStrategyRegistry } from "./core/loop-strategy-registry.js";

export { TaskRouter } from "./execution/task-router.js";
export type { RouteDecision } from "./execution/task-router.js";

// ── Core-2: 世界模型仿真层 ───────────────────────
// @experimental 计划执行因果推演（Phase 1 stub）
export { SimulationRunner, simulationRunner } from "./planning/simulation-runner.js";

export { EnvironmentAwareRouter } from "./execution/environment-aware-router.js";
export type { ModelHealth } from "./execution/environment-aware-router.js";

export { streamChat } from "./execution/chat-loop.js";
export type { ChatLoopOptions, ChatLoopResult } from "./execution/chat-loop.js";

// ── Core-2: 哨兵信号分层过滤器 ─────────────────
// @experimental L1/L2/L3 信号分层 + 去噪 + 采样
export { SentinelSignalFilter } from "./planning/sentinel-signal-filter.js";
export { ZeroTokenValidator } from "./execution/zero-token-validator.js";
export type { SignalLevel, FilteredSignal } from "./planning/sentinel-signal-filter.js";

// ── Core-2: 治理事件发射器 ─────────────────────
// @experimental DocGovernAgent 治理事件（修宪/审计/合规/圆桌）
export { GovernanceEventEmitter } from "./planning/governance-events.js";

export { DecisionGateBridge } from "./execution/decision-gate-bridge.js";

export { ResiliencePolicyFactory, resilienceFactory } from "./execution/resilience-integration.js";

export { NotificationRuntime } from "./planning/notification-runtime.js";

export { resolveByScope, type SkillScope } from "./planning/skill-scope.js";

// ── 记忆子系统（仅引擎胶水层） ──────────────────
export { executeWithMemoryPipeline, defaultMemoryQuery, makeMemoryQuery, resolvePipeline, DirectStep, DEFAULT_PIPELINE, DIRECT_PIPELINE, registerSkillPipeline, emitSkillReferenced, extractSkillUsageFromOutput } from "./memory-bridge/index.js";

// ── Cyrene 记忆层（L0/L1/L2 画像记忆扩展） ─────
export { initCyreneMemory } from "./bootstrap/init-memory.js";

// ── Bootstrap 集成入口 ──────────────────────────
export { bootstrapEngine, resolveLlm } from "./bootstrap/bootstrap-engine.js";
export type { BootstrapEngineOptions, BootstrapEngineResult } from "./bootstrap/bootstrap-engine.js";

// ── 引擎核心 ──────────────────────────────
// @note v3.x stable — 调度/平台/配置/LLM 类型请直接从对应包导入，engine barrel 不再重导出
export { Scheduler } from "./core/scheduler.js";
export { MetaAgentReplanAdapter } from "./core/meta-agent-adapter.js";

// ── Core-2: 降级边界 ────────────────────────
// @experimental 标准化空 catch 替代方案
export { DegradationBoundary } from "./core/degradation-boundary.js";

// ── 一致性层（六层防御） ─────────────────────────
// @note v2.6.7 兼容层已砍，直接导入 @cortex/governance

// ── 引擎组件 ────────────────────────────────────
export { PoolAwareState } from "./execution/pool-aware.js";
// DocRegistry → 从 @cortex/governance 直接导入

// ── 搜索后端 ───────────────────────────────────
// @note v2.6.7 兼容层已砍，直接导入 @cortex/platform

// ── 技能系统 ────────────────────────────────────
// SkillRegistry → 从 @cortex/skill-kit 直接导入

// ── Core-2: 引擎遥测 ───────────────────────────
// getTelemetry/setTelemetry/recordTelemetry → 从 @cortex/telemetry 直接导入

// ── v3.1 生命周期 & 优雅关闭 ─────────────────
export { LifecycleManager } from "./lifecycle/lifecycle-manager.js";
export { ShutdownOrchestrator } from "./core/shutdown-orchestrator.js";

// ── v3.1 文件锁管理器 ────────────────────────
export { FileLockManager } from "./core/file-lock-manager.js";

// ── v3.1 Agent 自声明系统 ─────────────────────
export { CapabilityRegistry, capabilityRegistry } from "./core/capability-registry.js";

// ── v3.1 Console → Observer 桥接 ─────────────
// installConsoleBridge/uninstallConsoleBridge → 从 @cortex/telemetry 直接导入
// vitest 下跨包 re-export 在 alias 中不解析，由引用方直接 import

// ── 引擎配置 ───────────────────────────────────
// 配置常量、默认值改用相对路径直接导入：

// ── 修宪管线 ───────────────────────────────────
// @note v2.6.7 兼容层已砍，直接导入 @cortex/governance

// ── LLM 适配 ─────────────────────────────────────
// @note LlmAdapter 由 @cortex/llm 提供，engine barrel 不再重导出
// CLI/外部消费者请直接从 @cortex/llm 导入

// ── v3.1 调度层接口类型（仅供测试兼容） ──────
// PipelineCtx/IStep → 从 @cortex/scheduler 直接导入

// ── Core-2 Batch1: AgentRegistry ───────────────
export { AgentRegistry, agentRegistry } from "./registry/agent-registry.js";
export type { AgentRegistration } from "./registry/agent-registry.js";

// ── 插件体系（v3.2 迁入 @cortex/plugin-runner）────
// PluginLoader → 从 @cortex/plugin-runner 直接导入
export { registerAgentFactory, getAgentFactory } from "./plugin/register-all.js";
export type { AgentFactory } from "./plugin/agent-factory-registry.js";

// ── 插件实例（v3.2 engine 内部使用，不再对外暴露类名）──
// 外部消费者应通过 PluginContainer.get("pipelineObserver") 等字符串名获取实例，
// 而非直接 import 插件类。插件类保留在 engine/src/plugin/ 内部文件中，
// bootstrap-engine.ts 通过 type-only import 引用。
