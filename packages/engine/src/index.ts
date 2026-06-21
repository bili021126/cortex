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

// ── Core-2: Prompt 管理 ────────────────────────
// @experimental prompt-kit 引擎集成层
export { PromptManager } from "./core/prompt-manager.js";
export type { PlanningPromptBlocks } from "./core/prompt-manager.js";

// ── Core-2: 循环策略注册表 ─────────────────────
// @experimental 可插拔循环策略（react/direct/decompose/jury）
export { LoopStrategyRegistry, loopStrategyRegistry } from "./core/loop-strategy-registry.js";
export type { LoopStrategy } from "./core/loop-strategy-registry.js";

// ── Core-2: 任务路由器 ─────────────────────────
// @experimental 统一策略+模型路由决策
export { TaskRouter } from "./core/task-router.js";
export type { RouteDecision } from "./core/task-router.js";

// ── Core-2: 环境感知路由器 ─────────────────────
// @experimental 运行时环境约束（模型可用性/配额/延迟）
export { EnvironmentAwareRouter } from "./core/environment-aware-router.js";
export type { ModelHealth, EnvironmentRouterOptions } from "./core/environment-aware-router.js";

// ── Core-2: 哨兵信号分层过滤器 ─────────────────
// @experimental L1/L2/L3 信号分层 + 去噪 + 采样
export { SentinelSignalFilter } from "./core/sentinel-signal-filter.js";
export { ZeroTokenValidator } from "./core/zero-token-validator.js";
export type { ZeroTokenRule, RuleResult, RuleContext } from "./core/zero-token-validator.js";
export type { SignalLevel, FilteredSignal, SignalFilterOptions } from "./core/sentinel-signal-filter.js";
export { getRejections } from "./core/hard-verification-gate.js";

// ── Core-2: 治理事件发射器 ─────────────────────
// @experimental DocGovernAgent 治理事件（修宪/审计/合规/圆桌）
export { GovernanceEventEmitter } from "./core/governance-events.js";
export type { GovernanceEventType, GovernanceEventPayload } from "./core/governance-events.js";

// ── Core-2: 决策门桥接器 ───────────────────────
// @experimental DECISION_REQUIRED → ConfirmGate 桥接
export { DecisionGateBridge } from "./core/decision-gate-bridge.js";
export type { DecisionRequest, DecisionResult } from "./core/decision-gate-bridge.js";

// ── Core-2: 韧性策略集成 ───────────────────────
// @experimental retry/circuit-breaker/timeout 引擎集成
export { ResiliencePolicyFactory, resilienceFactory } from "./core/resilience-integration.js";
export type { ResilienceOptions } from "./core/resilience-integration.js";

// ── Core-2: 通知运行时接入 ─────────────────────
// @experimental PipelineObserver → NotificationPipe 桥接
export { NotificationRuntime } from "./core/notification-runtime.js";
export type { NotificationRuntimeOptions } from "./core/notification-runtime.js";

// ── Core-2: 技能作用域 ─────────────────────────
// @experimental 四级作用域技能解析（跨域/项目/包级/Agent）
export { resolveByScope, tagSkillScope, type SkillScope } from "./core/skill-scope.js";

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
// DocRegistry → 从 @cortex/governance 直接导入

// ── 搜索后端 ───────────────────────────────────
// @note v2.6.7 兼容层已砍，直接导入 @cortex/platform

// ── 技能系统 ────────────────────────────────────
// SkillRegistry → 从 @cortex/skill-kit 直接导入

// ── Core-2: 引擎遥测 ───────────────────────────
// getTelemetry/setTelemetry/recordTelemetry → 从 @cortex/telemetry 直接导入

// ── v3.1 生命周期 & 优雅关闭 ─────────────────
export { LifecycleManager } from "./lifecycle/lifecycle-manager.js";
export { ShutdownWarden } from "./core/shutdown-warden.js";
export type { ShutdownReport } from "./core/shutdown-warden.js";

// ── v3.1 文件锁管理器 ────────────────────────
export { FileLockManager } from "./core/file-lock-manager.js";

// ── v3.1 Agent 自声明系统 ─────────────────────
export { CapabilityRegistry, capabilityRegistry } from "./core/capability-registry.js";

// ── v3.1 Console → Observer 桥接 ─────────────
// installConsoleBridge/uninstallConsoleBridge → 从 @cortex/telemetry 直接导入

// ── 引擎配置 ───────────────────────────────────
// @note 配置类型、常量、默认值统一由 @cortex/config 提供
// engine barrel 不再重导出——调用方请直接从 @cortex/config 导入

// ── 修宪管线 ───────────────────────────────────
// @note v2.6.7 兼容层已砍，直接导入 @cortex/governance

// ── LLM 适配 ─────────────────────────────────────
// @note LlmAdapter 由 @cortex/llm 提供，engine barrel 不再重导出
// CLI/外部消费者请直接从 @cortex/llm 导入

// ── v3.1 调度层接口类型（仅供测试兼容） ──────
// PipelineCtx/IStep → 从 @cortex/scheduler 直接导入

// ── 插件体系（v3.2 迁入 @cortex/plugin-runner）────
// PluginLoader → 从 @cortex/plugin-runner 直接导入
export { registerAgentFactory, getAgentFactory, hasAgentFactory, getRegisteredAgentTypes } from "./plugin/register-all.js";
export type { AgentFactory } from "./plugin/agent-factory-registry.js";

// ── 插件实例（v3.2 engine 内部使用，不再对外暴露类名）──
// 外部消费者应通过 PluginContainer.get("pipelineObserver") 等字符串名获取实例，
// 而非直接 import 插件类。插件类保留在 engine/src/plugin/ 内部文件中，
// bootstrap-engine.ts 通过 type-only import 引用。
