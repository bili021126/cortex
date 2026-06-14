// ============================================================
// @cortex/engine/plugin/trust-model.plugin
//
// TrustModel 插件——每引擎实例一份，无外部依赖。
// 注入 ConfirmGate 后启用动态信任判定。
//
// @since Core-2 — 信任模型插件化
// ============================================================

import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import { TrustModel } from "@cortex/scheduler";

export class TrustModelPlugin implements EnginePlugin {
  readonly name = "trustModel";
  readonly dependencies: string[] = [];

  private instance!: TrustModel;

  async init(_ctx: PluginContext): Promise<void> {
    this.instance = new TrustModel();
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    this.instance.resetAll();
  }

  health(): PluginHealth {
    return "healthy";
  }

  getInstance(): TrustModel {
    return this.instance;
  }
}

// 自注册
import { PluginLoader } from "./plugin-loader.js";
PluginLoader.register("trustModel", TrustModelPlugin);
