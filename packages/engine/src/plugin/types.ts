// ============================================================
// @cortex/engine/plugin/types —— 插件基础契约
//
// @module-convention
// 所有 Engine 子系统插件必须实现 EnginePlugin 接口。
// 插件间通信通过 PluginContext.get() 获取已初始化的依赖实例，
// 跨插件事件通知走 PipelineObserver（observer 字段）。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================

import type { IPipelineObserver, IFileSystemAdapter, IMemoryStore } from "@cortex/shared";
import type { EngineConfig } from "@cortex/config";
import type { LlmAdapter } from "@cortex/llm";
import type { BootstrapResult } from "@cortex/factory";
import type { Toolkit } from "@cortex/platform";

// ─── 插件健康状态 ─────────────────────────────────

/** 插件健康状态 */
export type PluginHealth = "healthy" | "degraded" | "dead";

// ─── 外部依赖 ─────────────────────────────────────

/**
 * PluginExternals —— 由外部（BootstrapEngineOptions）注入的非插件依赖。
 * 这些依赖不是插件体系的成员，但插件初始化时可能需要。
 */
export interface PluginExternals {
  /** LLM 适配器映射（key → LlmAdapter） */
  llms: Map<string, LlmAdapter>;
  /** 工具包（Toolkit） */
  toolkit: Toolkit;
  /** 编码规范文本 */
  codingStandards: string;
  /** 工厂配置（Agent 定义等） */
  factoryConfig: BootstrapResult;
  /** 可选：SQLite 数据库路径 */
  dbPath?: string;
  /** 可选：文件系统适配器 */
  fs?: IFileSystemAdapter;
  /** 可选：外部预构建的 MemoryStore（测试注入 mock embedder） */
  memory?: IMemoryStore;
}

// ─── 插件基础契约 ─────────────────────────────────

/**
 * EnginePlugin —— 引擎插件统一生命周期接口。
 *
 * 生命周期顺序：
 *   init() → start() → [运行时] → stop()
 *
 * - init()：组装内部状态，通过 ctx.get() 获取依赖实例
 * - start()：激活运行时（注册 PipelineObserver handler / 启动循环）
 * - stop()：优雅关闭（注销 handler / 释放资源）
 * - health()：运行时健康检查
 */
export interface EnginePlugin {
  /** 插件唯一名称——对应 engine-plugins.json 中的 key */
  readonly name: string;

  /** 依赖插件名列表——PluginLoader 按拓扑排序确保依赖项先初始化 */
  readonly dependencies: string[];

  /** 初始化——组装内部状态，通过 ctx 获取依赖 */
  init(ctx: PluginContext): Promise<void>;

  /** 激活运行时 */
  start(): Promise<void>;

  /** 优雅关闭 */
  stop(): Promise<void>;

  /** 运行时健康检查 */
  health(): PluginHealth;
}

// ─── 插件上下文 ───────────────────────────────────

/**
 * PluginContext —— init() 阶段注入的运行时环境。
 *
 * get<T>(name) 按插件名获取已初始化的依赖实例。
 * observer / config / workspaceRoot 是所有插件的公共上下文。
 * externals 携带由 BootstrapEngineOptions 注入的外部依赖。
 */
export interface PluginContext {
  /** 按名称获取已初始化的插件实例（泛型返回，调用方断言类型） */
  get<T>(name: string): T;

  /** 事件总线——插件间异步通信的唯一通道 */
  observer: IPipelineObserver;

  /** 合并后的全局引擎配置 */
  config: Required<EngineConfig>;

  /** 工作区根目录绝对路径 */
  workspaceRoot: string;

  /** 外部依赖——由 BootstrapEngineOptions 注入 */
  externals: PluginExternals;
}

// ─── 插件容器 ─────────────────────────────────────

/**
 * PluginContainer —— PluginLoader.load() 的返回结果。
 * 封装了全部已加载插件的生命周期管理。
 */
export interface PluginContainer {
  /** 按名称获取插件实例 */
  get<T>(name: string): T;

  /** 检查插件是否已加载 */
  has(name: string): boolean;

  /** 逆序停止全部插件 */
  shutdown(): Promise<void>;
}
