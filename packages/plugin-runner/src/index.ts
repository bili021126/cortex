// ============================================================
// @cortex/plugin-runner —— 插件基础设施桶导出
//
// 提供引擎插件体系的类型契约与加载容器。
// 插件实现（如 SchedulerPlugin、MemoryStorePlugin）仍在 engine 包内，
// 通过 PluginLoader.register() 自注册后由 bootstrap-engine.ts 加载。
//
// @since v3.2 — 独立包，横向解耦 Phase 3
// ============================================================

export type {
  EnginePlugin,
  PluginContext,
  PluginContainer,
  PluginExternals,
  PluginHealth,
} from "./types.js";

export { PluginLoader } from "./plugin-loader.js";
export type { EnginePluginLoadConfig } from "./plugin-loader.js";

export { PluginRegistry } from "./registry.js";
export { PluginRunner } from "./runner.js";
export { PluginValidator } from "./validator.js";
export { AbstractPlugin, isPlugin } from "./plugin.js";
export { PluginRunnerPlugin } from "./plugin-runner.plugin.js";
