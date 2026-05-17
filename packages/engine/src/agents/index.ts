// ============================================================
// @cortex/engine/agents —— Agent 全量桶导出
//
// @file-overview
// 本文档是 agents/ 目录的统一对外接口，收束全部 Agent 的
// 配置函数、MemoryQuery、SystemPrompt、旧类及实验性导出。
// 外部调用方应通过此桶或 @cortex/engine 主桶导入。
//
// @version 2.1.0
// ============================================================

// ════════════════════════════════════════════════════════════
// §1 配置函数（v2.1 组合式架构）
// @contract: 每个 *AgentConfig() 返回 AgentFactoryConfig，
// 是 createAgent() 的类型安全构造参数。
// ════════════════════════════════════════════════════════════

export { codeAgentConfig, codeMemoryQuery, SYSTEM_PROMPT as CodeSystemPrompt } from "./code-agent.js";
export { reviewAgentConfig, reviewMemoryQuery, SYSTEM_PROMPT as ReviewSystemPrompt } from "./review-agent.js";
export { analysisAgentConfig, analysisMemoryQuery } from "./analysis-agent.js";
export { opsAgentConfig, opsMemoryQuery, SYSTEM_PROMPT as OpsSystemPrompt } from "./ops-agent.js";
export { loopAgentConfig, loopMemoryQuery, SYSTEM_PROMPT as LoopSystemPrompt } from "./loop-agent.js";
export { docGovernAgentConfig, docGovernMemoryQuery, SYSTEM_PROMPT as DocGovernSystemPrompt } from "./doc-govern-agent.js";
export { apiAgentConfig, apiMemoryQuery, SYSTEM_PROMPT as ApiSystemPrompt } from "./api-agent.js";
export { dataAgentConfig, dataMemoryQuery, SYSTEM_PROMPT as DataSystemPrompt } from "./data-agent.js";
export { fixAgentConfig, fixMemoryQuery, SYSTEM_PROMPT as FixSystemPrompt } from "./fix-agent.js";

// ── 复杂 Agent 创建函数 ──────────────────────────
export { createInspectorAgent, SYSTEM_PROMPT as InspectorSystemPrompt } from "./inspector-agent.js";
export { createBrowserAgent, SYSTEM_PROMPT as BrowserSystemPrompt } from "./browser-agent.js";
export { ButlerAgent } from "./butler-agent.js";

// ════════════════════════════════════════════════════════════
// §2 特殊 Agent + Core-2 预留
// ════════════════════════════════════════════════════════════

// MetaAgent / StrategistAgent 待单独重构
export { MetaAgent } from "../meta-agent.js";
export { StrategistAgent } from "../strategist-agent.js";

// @experimental Core-2 预留
export { ApiAgent } from "./api-agent.js";
export { DataAgent } from "./data-agent.js";
