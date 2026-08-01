// @layer 规划-执行层
// ============================================================
// @cortex/engine/plugin/meta-agent.plugin
//
// MetaAgent 插件——依赖 PipelineObserver。
// 战术中枢：拆解意图 → 任务树 → 重规划仲裁 → 多 Agent 聚合。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================

import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import type { Disposable } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { BootstrapResult } from "../bootstrap/factory/index.js";
import { MetaAgent } from "../core/meta-agent.js";
import { resolveLlm } from "../bootstrap/load-config.js";

export class MetaAgentPlugin implements EnginePlugin {
  readonly name = "metaAgent";
  readonly dependencies = ["pipelineObserver"];

  private instance!: MetaAgent;

  async init(ctx: PluginContext): Promise<void> {
    const observer = ctx.get<PipelineObserverPlugin>("pipelineObserver").getInstance();
    const llmMap = ctx.externals.llms as Map<string, LlmAdapter>;
    const fConfig = ctx.externals.factoryConfig as BootstrapResult;

    const metaDef = fConfig.agentDefinitions.find((d) => d.type === "meta");
    const llm = resolveLlm(llmMap, metaDef?.key);

    this.instance = new MetaAgent(
      llm,
      undefined, // skillRegistry——SkillSystem 插件启动后通过 setSkillRegistry 注入
      metaDef?.planningPrompt,
      metaDef?.replanPrompt,
      observer,
      ctx.workspaceRoot,
    );
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    (this.instance as unknown as Disposable).shutdown?.();
  }

  health(): PluginHealth {
    return this.instance ? "healthy" : "dead";
  }

  getInstance(): MetaAgent {
    return this.instance;
  }
}

import type { PipelineObserverPlugin } from "./pipeline-observer.plugin.js";
