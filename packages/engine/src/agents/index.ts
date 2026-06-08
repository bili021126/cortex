// ============================================================
// @cortex/engine/agents —— Agent 全量桶导出
//
// @version 3.0.0 — 声明式重构：所有 Agent 配置从 registry.ts 统一导出
// ============================================================

// ── 配置函数 + MemoryQueries（来自声明式注册表） ──
export {
  codeAgentConfig, codeMemoryQuery,
  reviewAgentConfig, reviewMemoryQuery,
  analysisAgentConfig, analysisMemoryQuery,
  opsAgentConfig, opsMemoryQuery,
  loopAgentConfig, loopMemoryQuery,
  docGovernAgentConfig, docGovernMemoryQuery,
  apiAgentConfig, apiMemoryQuery,
  dataAgentConfig, dataMemoryQuery,
  fixAgentConfig, fixMemoryQuery,
} from "./registry.js";

// ── 复杂 Agent 创建函数 ──────────────────────────
export { createInspectorAgent } from "./inspector-agent.js";
export { createBrowserAgent } from "./browser-agent.js";
export { ButlerAgent } from "./butler-agent.js";

// ── 特殊 Agent + Core-2 预留 ────────────────────
export { MetaAgent, type IntentClarification } from "../core/meta-agent.js";
export { StrategistAgent } from "./strategist-agent.js";

// @experimental Core-2 预留
export { ApiAgent } from "./api-agent.js";
export { DataAgent } from "./data-agent.js";
