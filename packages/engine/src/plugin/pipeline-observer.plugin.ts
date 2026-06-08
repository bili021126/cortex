// ============================================================
// @cortex/engine/plugin/pipeline-observer.plugin
//
// PipelineObserver 插件——零依赖，事件总线根基。
// 所有插件 init() 前必须先加载此插件，observer 通过 PluginContext 传递给下游。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================

import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import type { Disposable } from "@cortex/shared";
import { PipelineObserver } from "../core/pipeline-observer.js";

export class PipelineObserverPlugin implements EnginePlugin {
  readonly name = "pipelineObserver";
  readonly dependencies: string[] = [];

  private instance!: PipelineObserver;

  async init(_ctx: PluginContext): Promise<void> {
    this.instance = new PipelineObserver();
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    (this.instance as unknown as Disposable).clear?.();
  }

  health(): PluginHealth {
    return this.instance ? "healthy" : "dead";
  }

  /** 获取 PipelineObserver 实例（供其他插件通过 ctx.get() 使用） */
  getInstance(): PipelineObserver {
    return this.instance;
  }
}

// 自注册（副作用导入——import 即注册，无需手动调用 register）
import { PluginLoader } from "./plugin-loader.js";
PluginLoader.register("pipelineObserver", PipelineObserverPlugin);
PluginLoader.register("pipelineObserver", PipelineObserverPlugin);
