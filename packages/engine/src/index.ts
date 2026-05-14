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
// ============================================================

// ── 工厂组件（v2.1 组合式架构）─────────────────────────
// @contract: createAgent + runReActLoop + extractSkillsFromOutput 构成
// Agent 运行时三件套。外部调用方通过 createAgent(config, adapter, ...) → Agent
// 实例获取可执行 Agent；runReActLoop 提供标准 ReAct 循环；extractSkillsFromOutput
// 解析 Agent 输出中的技能模板。MemoryStoreMonitor 和 MemoryPipeline 提供
// 记忆子系统接入点。
export { createAgent } from "./components/agent-factory.js";
export type { AgentFactoryConfig } from "./components/agent-factory.js";
export { runReActLoop } from "./components/react-loop.js";
export type { ReActContext } from "./components/react-loop.js";
export { extractSkillsFromOutput } from "./components/skill-extractor.js";
export type { SkillExtractResult } from "./components/skill-extractor.js";
export { executeWithMemoryPipeline, defaultMemoryQuery, makeMemoryQuery } from "./memory/pipeline.js";
export { MemoryStoreMonitor } from "./memory/monitor.js";

// ── Agent 配置函数（v2.1 组合式） ──────────────────────
// @contract: 每个 *AgentConfig() 返回 AgentFactoryConfig，是 createAgent() 的
// 类型安全构造参数。*MemoryQuery() 为各 Agent 提供默认 MemoryQuery。
// SYSTEM_PROMPT 导出提供 System Prompt 模板（供 bootstrap 注入）。
export { codeAgentConfig, codeMemoryQuery, SYSTEM_PROMPT as CodeSystemPrompt } from "./agents/code-agent.js";
export { reviewAgentConfig, reviewMemoryQuery, SYSTEM_PROMPT as ReviewSystemPrompt } from "./agents/review-agent.js";
export { analysisAgentConfig, analysisMemoryQuery } from "./agents/analysis-agent.js";
export { opsAgentConfig, opsMemoryQuery, SYSTEM_PROMPT as OpsSystemPrompt } from "./agents/ops-agent.js";
export { loopAgentConfig, loopMemoryQuery, SYSTEM_PROMPT as LoopSystemPrompt } from "./agents/loop-agent.js";
export { docGovernAgentConfig, docGovernMemoryQuery, SYSTEM_PROMPT as DocGovernSystemPrompt } from "./agents/doc-govern-agent.js";
export { apiAgentConfig, apiMemoryQuery, SYSTEM_PROMPT as ApiSystemPrompt } from "./agents/api-agent.js";
export { dataAgentConfig, dataMemoryQuery, SYSTEM_PROMPT as DataSystemPrompt } from "./agents/data-agent.js";
export { fixAgentConfig, fixMemoryQuery, SYSTEM_PROMPT as FixSystemPrompt } from "./agents/fix-agent.js";
// 复杂 Agent 创建函数
export { createInspectorAgent, SYSTEM_PROMPT as InspectorSystemPrompt } from "./agents/inspector-agent.js";
export { createBrowserAgent, SYSTEM_PROMPT as BrowserSystemPrompt } from "./agents/browser-agent.js";
export { ButlerAgent } from "./agents/butler-agent.js";

// ── 旧 Agent 类（向后兼容，逐步废弃） ──────────────────
// @contract: 旧版 Agent 类提供与 v2.0 兼容的类实例化路径。所有旧类标记
// @deprecated，在下一个次版本（v2.2）移除。外部调用方应迁移至
// createAgent(*AgentConfig(), ...) 组合式路径。
// MetaAgent / StrategistAgent 待单独重构。
/** @deprecated 使用 createAgent(codeAgentConfig(), ...) 替代 */
export { CodeAgent } from "./agents/code-agent.js";
/** @deprecated 使用 createAgent(reviewAgentConfig(), ...) 替代 */
export { ReviewAgent } from "./agents/review-agent.js";
/** @deprecated 使用 createAgent(analysisAgentConfig(), ...) 替代 */
export { AnalysisAgent } from "./agents/analysis-agent.js";
/** @deprecated 使用 createAgent(opsAgentConfig(), ...) 替代 */
export { OpsAgent } from "./agents/ops-agent.js";
/** @deprecated 使用 createAgent(loopAgentConfig(), ...) 替代 */
export { LoopAgent } from "./agents/loop-agent.js";
/** @deprecated 使用 createAgent(docGovernAgentConfig(), ...) 替代 */
export { DocGovernAgent } from "./agents/doc-govern-agent.js";
/** @deprecated 使用 createAgent(fixAgentConfig(), ...) 替代 */
export { FixAgent } from "./agents/fix-agent.js";
/** @deprecated 使用 createInspectorAgent(...) 替代 */
export { InspectorAgent } from "./agents/inspector-agent.js";
/** @deprecated 使用 createBrowserAgent(...) 替代 */
export { BrowserAgent } from "./agents/browser-agent.js";
// MetaAgent / StrategistAgent 待单独重构
export { MetaAgent } from "./meta-agent.js";
export { StrategistAgent } from "./strategist-agent.js";
// @experimental Core-2 预留
export { ApiAgent } from "./agents/api-agent.js";
export { DataAgent } from "./agents/data-agent.js";

export { PoolAwareState } from "./pool-aware.js";

// 引擎核心
// @contract: Scheduler + TaskBoard + AgentPool + ConfirmGate + PipelineObserver
// 构成调度五元组。FileLockManager 提供文件锁。Toolkit 提供 Agent 工具注入。
// LlmAdapter（来自 @cortex/llm）提供 LLM 适配。CLIAdapter 提供 CLI 入口。
// MemoryStore 提供记忆中枢。
export { Scheduler, topologicalSort } from "./scheduler.js";
export { TaskBoard } from "./task-board.js";
export { ConfirmGate } from "./confirm-gate.js";
export { PipelineObserver } from "./pipeline-observer.js";
export { FileLockManager } from "./file-lock-manager.js";
export { Toolkit } from "./toolkit.js";
export { LlmAdapter } from "@cortex/llm";
export { CLIAdapter } from "./cli-adapter.js";
export { MemoryStore } from "./memory-store.js";
// MemoryWriteInput 已迁移至 @cortex/shared，从 shared 重新导出以保持向后兼容
export type { MemoryWriteInput } from "@cortex/shared";
// NodeFileSystemAdapter 为 IFileSystemAdapter 的 Node.js 默认实现
export { NodeFileSystemAdapter } from "./node-fs-adapter.js";
