// ============================================================
// @cortex/engine/plugin/agent-pool.plugin
//
// AgentPool 插件——依赖 PipelineObserver。
// 管理 Agent 实例生命周期、状态机转换、spawn/destroy。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================

import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import type { Disposable } from "@cortex/shared";
import { AgentPool } from "@cortex/scheduler";

export class AgentPoolPlugin implements EnginePlugin {
  readonly name = "agentPool";
  readonly dependencies = ["pipelineObserver"];

  private instance!: AgentPool;

  async init(ctx: PluginContext): Promise<void> {
    const observer = ctx.get<PipelineObserverPlugin>("pipelineObserver").getInstance();
    this.instance = new AgentPool();
    this.instance.setObserver(observer);
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    (this.instance as unknown as Disposable).destroyAll?.();
  }

  health(): PluginHealth {
    return this.instance ? "healthy" : "dead";
  }

  getInstance(): AgentPool {
    return this.instance;
  }
}

import type { PipelineObserverPlugin } from "./pipeline-observer.plugin.js";

// 自注册
import { PluginLoader } from "./plugin-loader.js";
PluginLoader.register("agentPool", AgentPoolPlugin);
PluginLoader.register("agentPool", AgentPoolPlugin);
