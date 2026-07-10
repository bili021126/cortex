/**
 * @cortex/plugin-runner — EnginePlugin 适配器
 *
 * 将 PluginRunner 包装为一级 EnginePlugin，使其可被 PluginLoader 加载。
 *
 * 作为 @cortex/engine 的一级插件，遵循引擎插件生命周期：
 *   init(ctx) → start() → stop()
 */

import type { EnginePlugin, PluginContext } from "./types.js";
import { PluginRegistry } from "./registry.js";
import { PluginRunner } from "./runner.js";
import { PluginValidator } from "./validator.js";

/**
 * 二级插件配置项（暂未注册到 @cortex/config 的 CONFIG_DOMAINS，
 * 通过 ctx.config 的扩展属性读取）。
 */
interface PluginRunnerConfig {
  defaultTimeout?: number;
  plugins?: Array<{
    name: string;
    filePath: string;
    enabled?: boolean;
    timeout?: number;
    config?: Record<string, unknown>;
  }>;
}

/**
 * PluginRunnerPlugin —— EnginePlugin 适配器。
 *
 * 将 PluginRunner 包装为引擎可加载的一级插件。
 * 在 start() 阶段从配置读取二级插件清单并注册。
 */
export class PluginRunnerPlugin implements EnginePlugin {
  readonly name = "pluginRunner";
  readonly dependencies = ["pipelineObserver", "memoryStore"];

  private _registry!: PluginRegistry;
  private _validator!: PluginValidator;
  private _runner!: PluginRunner;
  private _ctx!: PluginContext;

  /**
   * 可选——插件加载失败时的回调。
   * 不注入则静默忽略。注入后可供上层接入 PipelineObserver 或自定义日志。
   */
  onPluginLoadError?: (pluginName: string, error: unknown) => void;

  /**
   * 初始化——创建 PluginRunner 实例，从 ctx.config 读取二级插件配置。
   */
  async init(ctx: PluginContext): Promise<void> {
    this._ctx = ctx;

    const pluginRunnerCfg = (ctx.config as Record<string, unknown>).pluginRunner as
      | PluginRunnerConfig
      | undefined;

    this._registry = new PluginRegistry();
    this._validator = new PluginValidator();
    this._runner = new PluginRunner(this._registry, this._validator, {
      timeout: pluginRunnerCfg?.defaultTimeout ?? 30_000,
    });
  }

  /**
   * 启动——按配置发现并注册二级插件。
   */
  async start(): Promise<void> {
    const pluginRunnerCfg = (this._ctx.config as Record<string, unknown>).pluginRunner as
      | PluginRunnerConfig
      | undefined;

    if (!pluginRunnerCfg?.plugins) return;

    for (const entry of pluginRunnerCfg.plugins) {
      if (entry.enabled === false) continue;

      try {
        // 动态导入插件模块
        const mod = await import(entry.filePath);
        const PluginClass = mod.default ?? mod[entry.name];

        if (typeof PluginClass !== "function") {
          this.onPluginLoadError?.(
            entry.name,
            new Error(`未找到有效的插件导出`),
          );
          continue;
        }

        const plugin = new PluginClass();
        this._registry.register(plugin);
      } catch (err) {
        this.onPluginLoadError?.(entry.name, err);
      }
    }
  }

  /**
   * 停止——调用 PluginRunner.shutdown() 清理资源。
   */
  async stop(): Promise<void> {
    await this._runner.shutdown();
  }

  /**
   * 健康检查。
   */
  health(): "healthy" | "degraded" | "dead" {
    return "healthy";
  }

  /**
   * 获取 PluginRunner 实例（供其他一级插件获取）。
   */
  getInstance(): PluginRunner {
    return this._runner;
  }
}
