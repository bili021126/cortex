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
import { ConfirmGate } from "@cortex/scheduler";
import { CLIAdapter } from "@cortex/platform";
export class ConfirmGatePlugin {
    name = "confirmGate";
    dependencies = ["pipelineObserver", "trustModel"];
    instance;
    cliAdapter;
    async init(ctx) {
        this.instance = new ConfirmGate(ctx.config.toolTimeouts.confirmWait);
        this.cliAdapter = new CLIAdapter();
        this.instance.setBridge(this.cliAdapter);
        // ── 注入 TrustModel：使 L1 操作支持信任动态免确认 ──
        try {
            const trustModel = ctx.get("trustModel").getInstance();
            this.instance.setTrustModel(trustModel);
        }
        catch {
            // trustModel 插件可选缺省——缺时回退到固定确认模式
        }
    }
    async start() { }
    async stop() {
        this.instance.dispose();
        this.cliAdapter.close?.();
    }
    health() {
        return this.instance ? "healthy" : "dead";
    }
    getInstance() {
        return this.instance;
    }
    getCliAdapter() {
        return this.cliAdapter;
    }
}
//# sourceMappingURL=confirm-gate.plugin.js.map