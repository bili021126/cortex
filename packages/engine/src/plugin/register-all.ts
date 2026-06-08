// ============================================================
// @cortex/engine/plugin/register-all —— 插件桶（副作用导入）
//
// 每个插件文件末尾已自注册（PluginLoader.register），
// 本模块仅需 import 全部插件——副作用触发注册。
//
// 新增插件：创建 xx.plugin.ts → 在下方加一行 import。
//          无需手写 PluginLoader.register(...) 调用。
//
// @since v3.1 — 配置驱动装配
// ============================================================

import "./pipeline-observer.plugin.js";
import "./task-board.plugin.js";
import "./agent-pool.plugin.js";
import "./confirm-gate.plugin.js";
import "./memory-store.plugin.js";
import "./meta-agent.plugin.js";
import "./consistency-layer.plugin.js";
import "./governance.plugin.js";
import "./scheduler.plugin.js";

// registerAgentFactory 已内建在 scheduler.plugin.ts 的 _registerBuiltinAgentFactories() 中。
// 新增 Agent 类型工厂：在 scheduler.plugin.ts 的工厂注册块添加 registerAgentFactory(...) 即可。

export { registerAgentFactory, getAgentFactory, hasAgentFactory, getRegisteredAgentTypes } from "./agent-factory-registry.js";
export type { AgentFactory } from "./agent-factory-registry.js";
