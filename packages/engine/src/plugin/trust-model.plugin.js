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
import { TrustModel } from "@cortex/scheduler";
export class TrustModelPlugin {
    name = "trustModel";
    dependencies = [];
    instance;
    async init(_ctx) {
        this.instance = new TrustModel();
    }
    async start() { }
    async stop() {
        this.instance.resetAll();
    }
    health() {
        return "healthy";
    }
    getInstance() {
        return this.instance;
    }
}
//# sourceMappingURL=trust-model.plugin.js.map