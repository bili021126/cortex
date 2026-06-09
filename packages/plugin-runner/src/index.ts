/**
 * @cortex/plugin-runner — 二级插件运行器
 *
 * 管理外部/用户定义插件的生命周期（init → execute → destroy）、
 * 沙箱执行、插件注册表与 Schema 校验及配置管理。
 *
 * # 模块划分
 *
 * - `types.ts`                — 所有接口/类型定义（Plugin, PluginMeta, ExecuteContext 等）
 * - `plugin.ts`               — AbstractPlugin 抽象基类 + 工具函数
 * - `registry.ts`             — PluginRegistry — 注册/发现/依赖解析
 * - `runner.ts`               — PluginRunner — 沙箱执行引擎
 * - `validator.ts`            — PluginValidator — Schema 校验
 * - `config.ts`               — PluginConfigManager — JSON 配置外部化与管理
 * - `schema.ts`               — PluginSchema 定义：类型校验原语 + Schema 构建器
 * - `plugin-runner.plugin.ts` — EnginePlugin 适配器 + 自注册
 *
 * @packageDocumentation
 */

// ── 类型导出 ──
export type {
  Plugin,
  PluginMeta,
  PluginHooks,
  ExecuteContext,
  PluginResult,
  PluginEvent,
  PluginSchema,
  PluginStatus,
  ExecutionReport,
  ValidationResult,
} from "./types.js";

// 注: PluginConfig (interface) 定义在 types.ts 中，
// 可作为类型通过 Plugin 泛型参数使用，无须从 barrel 单独导出。
// 配置管理类 PluginConfigManager 从 config.ts 导出。

// ── 类导出 ──
export { AbstractPlugin, isPlugin } from "./plugin.js";
export { PluginRegistry } from "./registry.js";
export { PluginRunner } from "./runner.js";
export { PluginValidator } from "./validator.js";
export { PluginRunnerPlugin } from "./plugin-runner.plugin.js";

// ── 配置管理导出 ──
export {
  PluginConfigManager,
  loadPluginConfig,
  createPluginConfig,
} from "./config.js";
export type {
  PluginConfigFile,
  PluginConfigManagerOptions,
} from "./config.js";

// ── Schema 校验原语导出 ──
export {
  s,
  StringValidator,
  NumberValidator,
  BooleanValidator,
  ObjectValidator,
  ArrayValidator,
  definePluginSchema,
  defineConfigSchema,
  composeSchemas,
  baseConfigSchema,
  strictConfigSchema,
  defaultPluginSchema,
  createMinimalSchema,
  validation,
} from "./schema.js";
export type {
  TypeValidator,
  ValidationErrors,
  SchemaDefinition,
} from "./schema.js";
