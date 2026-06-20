// ============================================================
// @cortex/engine/plugin/trust-model.plugin
//
// TrustModel 插件——每引擎实例一份，无外部依赖。
// @layer 治理层
// @role 恢复者——信任判分（预留，Core-2 后期激活）
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


