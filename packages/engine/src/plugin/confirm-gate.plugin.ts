// @layer 治理层
// ============================================================
// @cortex/engine/plugin/confirm-gate.plugin
//
// ConfirmGate 插件——依赖 PipelineObserver + TrustModel。
// 基于可逆性等级拦截工具调用，L2/L3 永远确认。
// 注入 TrustModel 后 L1 操作可动态免确认（信任等级 L3）。
//
// @since v3.0 — 引擎插件化解耦
// @since Core-2 — TrustModel 集成：L1 信任等级 ≥ L3 免确认
// ============================================================

import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import { ConfirmGate } from "@cortex/scheduler";
import { DegradationBoundary } from "../core/degradation-boundary.js";
import { CLIAdapter } from "@cortex/platform";

export class ConfirmGatePlugin implements EnginePlugin {
  readonly name = "confirmGate";
  readonly dependencies = ["pipelineObserver", "trustModel"];

  private instance!: ConfirmGate;
  private cliAdapter!: CLIAdapter;

  async init(ctx: PluginContext): Promise<void> {
    this.instance = new ConfirmGate(ctx.config.toolTimeouts.confirmWait);
    this.cliAdapter = new CLIAdapter();
    this.instance.setBridge(this.cliAdapter);

    // ── 注入 TrustModel：使 L1 操作支持信任动态免确认 ──
    try {
      const trustModel = ctx.get<TrustModelPlugin>("trustModel").getInstance();
      this.instance.setTrustModel(trustModel);
    } catch (err) { DegradationBoundary.handle(err, 'confirm-gate-plugin', 'trace');
      // trustModel 插件可选缺省——缺时回退到固定确认模式
    }
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

  // R13-harness：eval 桩注入（gate-blocks 用例——替换 bridge 为桩记录 confirm 调用）
  setBridgeOverride(bridge: { confirm: (req: never) => Promise<never> }): void {
    this.instance.setBridge(bridge as never);
  }
}

import type { TrustModelPlugin } from "./trust-model.plugin.js";
