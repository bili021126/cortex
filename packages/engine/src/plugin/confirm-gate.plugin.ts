// ============================================================
// @cortex/engine/plugin/confirm-gate.plugin
//
// ConfirmGate 插件——依赖 PipelineObserver。
// 基于可逆性等级拦截工具调用，L2/L3 永远确认。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================

import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import { ConfirmGate } from "@cortex/scheduler";
import { CLIAdapter } from "@cortex/platform";

export class ConfirmGatePlugin implements EnginePlugin {
  readonly name = "confirmGate";
  readonly dependencies = ["pipelineObserver"];

  private instance!: ConfirmGate;
  private cliAdapter!: CLIAdapter;

  async init(ctx: PluginContext): Promise<void> {
    this.instance = new ConfirmGate(ctx.config.toolTimeouts.confirmWait);
    this.cliAdapter = new CLIAdapter();
    this.instance.setBridge(this.cliAdapter);
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    this.instance.dispose();
    this.cliAdapter.close?.();
  }

  health(): PluginHealth {
    return this.instance ? "healthy" : "dead";
  }

  getInstance(): ConfirmGate {
    return this.instance;
  }

  getCliAdapter(): CLIAdapter {
    return this.cliAdapter;
  }
}

// 自注册
import { PluginLoader } from "./plugin-loader.js";
PluginLoader.register("confirmGate", ConfirmGatePlugin);
