// ============================================================
// @cortex/engine/plugin/plugin-loader —— 插件加载容器
//
// PluginLoader 职责：
//   1. 按 engine-plugins.json 声明加载插件
//   2. 拓扑排序（依赖关系）
//   3. 依次 init() → postInit() → start()
//   4. 返回 PluginContainer 封装 shutdown()
//
// @since v3.0 — 引擎插件化解耦
// ============================================================

import type { EnginePlugin, PluginContext, PluginContainer, PluginExternals } from "./types.js";
import type { IPipelineObserver } from "@cortex/shared";
import { resolveConfig, type EngineConfig } from "@cortex/config";

// ─── 配置 ─────────────────────────────────────────

/** 插件加载配置 */
export interface EnginePluginLoadConfig {
  /** 要加载的插件名列表（按 engine-plugins.json 声明） */
  plugins: string[];
  /** 引擎配置（可部分覆盖默认值） */
  engineConfig?: EngineConfig;
  /** 工作区根目录 */
  workspaceRoot: string;
  /** 外部依赖 */
  externals: PluginExternals;
}

// ─── 插件注册表 ──────────────────────────────────

type PluginConstructor = new () => EnginePlugin;

// ─── PluginLoader ─────────────────────────────────

export class PluginLoader {
  /** 插件构造器注册表：name → constructor */
  private static _registry = new Map<string, PluginConstructor>();

  /** 注册插件构造器 */
  static register(name: string, ctor: PluginConstructor): void {
    PluginLoader._registry.set(name, ctor);
  }

  /** 获取已注册的插件名列表 */
  static getRegisteredNames(): string[] {
    return [...PluginLoader._registry.keys()];
  }

  // ── 实例 ──────────────────────────────────────

  private _plugins = new Map<string, EnginePlugin>();
  private _inited = false;
  private _started = false;
  private _ctx!: PluginContext;
  private _config!: EnginePluginLoadConfig;

  /**
   * 加载并启动全部插件。
   * 返回 PluginContainer——调用方通过 container.get() 取 Scheduler/MemoryStore 等。
   */
  async load(config: EnginePluginLoadConfig): Promise<PluginContainer> {
    this._config = config;
    const mergedConfig = resolveConfig(config.engineConfig);

    // §1 实例化请求的插件
    const instances = this._instantiate(config.plugins);

    // §2 拓扑排序
    const sorted = this._topologicalSort(instances);

    // §3 创建 PluginContext（栈分配——闭包捕获 instances 引用）
    const ctx = this._createContext(sorted, mergedConfig, config.externals, config.workspaceRoot);
    this._ctx = ctx;

    // §4 依次 init()
    for (const plugin of sorted) {
      await plugin.init(ctx);
    }
    this._inited = true;

    // §5 postInit 跨插件织入（Scheduler 注册 Agent / SkillSystem 恢复技能）
    await this._postInit(ctx, sorted);

    // §6 依次 start()
    for (const plugin of sorted) {
      await plugin.start();
    }
    this._started = true;

    return {
      get: <T>(name: string): T => {
        const plugin = this._plugins.get(name);
        if (!plugin) throw new Error(`[PluginLoader] 插件 "${name}" 未加载`);
        return plugin as unknown as T;
      },
      has: (name: string): boolean => this._plugins.has(name),
      shutdown: async () => {
        // 逆序停止
        for (let i = sorted.length - 1; i >= 0; i--) {
          try {
            await sorted[i].stop();
          } catch (e) {
            console.warn(`[PluginLoader] 停止插件 "${sorted[i].name}" 时出错:`, e);
          }
        }
        this._started = false;
        this._inited = false;
      },
    };
  }

  // ── 私有方法 ──────────────────────────────────

  /** 从构造器注册表实例化请求的插件 */
  private _instantiate(names: string[]): EnginePlugin[] {
    const instances: EnginePlugin[] = [];
    const seen = new Set<string>();

    for (const name of names) {
      if (seen.has(name)) {
        throw new Error(`[PluginLoader] 重复声明插件: "${name}"`);
      }
      const ctor = PluginLoader._registry.get(name);
      if (!ctor) {
        throw new Error(`[PluginLoader] 未注册的插件: "${name}"。可用: [${[...PluginLoader._registry.keys()].join(", ")}]`);
      }
      const instance = new ctor();
      instances.push(instance);
      this._plugins.set(name, instance);
      seen.add(name);
    }

    return instances;
  }

  /** 拓扑排序——Kahn 算法，按 dependencies 声明计算加载顺序 */
  private _topologicalSort(instances: EnginePlugin[]): EnginePlugin[] {
    const nameToPlugin = new Map<string, EnginePlugin>();
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const p of instances) {
      nameToPlugin.set(p.name, p);
      inDegree.set(p.name, 0);
      adjacency.set(p.name, []);
    }

    // 构建邻接表和入度
    for (const p of instances) {
      for (const dep of p.dependencies) {
        if (!nameToPlugin.has(dep)) {
          throw new Error(
            `[PluginLoader] 插件 "${p.name}" 依赖 "${dep}"，但 "${dep}" 未在加载清单中。` +
            `请确保 engine-plugins.json 中 "${dep}" 排在 "${p.name}" 之前。`,
          );
        }
        const adjList = adjacency.get(dep);
        if (adjList) adjList.push(p.name);
        inDegree.set(p.name, (inDegree.get(p.name) ?? 0) + 1);
      }
    }

    // Kahn 算法
    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    const sorted: EnginePlugin[] = [];
    while (queue.length > 0) {
      const name = queue.shift();
      if (!name) continue;
      const plugin = nameToPlugin.get(name);
      if (!plugin) continue;
      sorted.push(plugin);

      const neighbors = adjacency.get(name);
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    if (sorted.length !== instances.length) {
      const remaining = instances.filter((p) => !sorted.includes(p)).map((p) => p.name);
      throw new Error(`[PluginLoader] 检测到循环依赖，无法排序。剩余未加载: [${remaining.join(", ")}]`);
    }

    return sorted;
  }

  /** 创建 PluginContext */
  private _createContext(
    _sorted: EnginePlugin[],
    config: Required<EngineConfig>,
    externals: PluginExternals,
    workspaceRoot: string,
  ): PluginContext {
    return {
      observer: this._ctx?.observer ?? ({} as IPipelineObserver), // 将在 init 阶段由 pipelineObserver 插件覆盖
      config,
      workspaceRoot,
      externals,
      get: <T>(name: string): T => {
        const plugin = this._plugins.get(name);
        if (!plugin) throw new Error(`[PluginLoader] 插件 "${name}" 尚未初始化`);
        return plugin as unknown as T;
      },
    };
  }

  /**
   * postInit: 全部插件 init 完成后，执行跨插件织入。
   * - Scheduler.registerAllAgents() 内部完成 Agent 注册 + SkillSystem finalize
   */
  private async _postInit(ctx: PluginContext, _sorted: EnginePlugin[]): Promise<void> {
    const schedulerPlugin = this._plugins.get("scheduler") as SchedulerPlugin;

    if (schedulerPlugin) {
      await schedulerPlugin.registerAllAgents(ctx);
    }
  }
}

// 前向声明插件类型
import type { SchedulerPlugin } from "./scheduler.plugin.js";
