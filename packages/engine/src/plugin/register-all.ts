// ============================================================
// @cortex/engine/plugin/register-all —— 集中注册全部插件
//
// v3.2 改为集中式注册：PluginLoader.register() 在此统一调用，
// 不再散落在各插件文件底部。
//
// 新增插件：1) 创建 xx.plugin.ts  2) 下方加一行 import + register
//           3) engine-plugins.json 加插件名
//
// @since v3.1 — 配置驱动装配
// @since v3.2 — 集中注册，消除副作用自注册
// ============================================================

import { PluginLoader } from "@cortex/plugin-runner";

import { PipelineObserverPlugin } from "./pipeline-observer.plugin.js";
import { TaskBoardPlugin } from "./task-board.plugin.js";
import { AgentPoolPlugin } from "./agent-pool.plugin.js";
import { ConfirmGatePlugin } from "./confirm-gate.plugin.js";
import { TrustModelPlugin } from "./trust-model.plugin.js";
import { FileLockManagerPlugin } from "./file-lock-manager.plugin.js";
import { MemoryStorePlugin } from "./memory-store.plugin.js";
import { MetaAgentPlugin } from "./meta-agent.plugin.js";
import { ConsistencyLayerPlugin } from "./consistency-layer.plugin.js";
import { SchedulerPlugin } from "./scheduler.plugin.js";

PluginLoader.register("pipelineObserver", PipelineObserverPlugin);
PluginLoader.register("taskBoard", TaskBoardPlugin);
PluginLoader.register("agentPool", AgentPoolPlugin);
PluginLoader.register("confirmGate", ConfirmGatePlugin);
PluginLoader.register("trustModel", TrustModelPlugin);
PluginLoader.register("fileLockManager", FileLockManagerPlugin);
PluginLoader.register("memoryStore", MemoryStorePlugin);
PluginLoader.register("metaAgent", MetaAgentPlugin);
PluginLoader.register("consistencyLayer", ConsistencyLayerPlugin);
PluginLoader.register("scheduler", SchedulerPlugin);

// registerAgentFactory 已内建在 scheduler.plugin.ts 的 _registerBuiltinAgentFactories() 中。
// 新增 Agent 类型工厂：在 scheduler.plugin.ts 的工厂注册块添加 registerAgentFactory(...) 即可。

export { registerAgentFactory, getAgentFactory, hasAgentFactory, getRegisteredAgentTypes } from "./agent-factory-registry.js";
export type { AgentFactory } from "./agent-factory-registry.js";
