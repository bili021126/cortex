// ============================================================
// @cortex/engine/plugin/agent-pool.plugin
//
// AgentPool 插件——依赖 PipelineObserver。
// 管理 Agent 实例生命周期、状态机转换、spawn/destroy。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================
import { AgentPool } from "@cortex/scheduler";
export class AgentPoolPlugin {
    name = "agentPool";
    dependencies = ["pipelineObserver"];
    instance;
    async init(ctx) {
        const observer = ctx.get("pipelineObserver").getInstance();
        this.instance = new AgentPool();
        this.instance.setObserver(observer);
    }
    async start() { }
    async stop() {
        this.instance.destroyAll?.();
    }
    health() {
        return this.instance ? "healthy" : "dead";
    }
    getInstance() {
        return this.instance;
    }
}
//# sourceMappingURL=agent-pool.plugin.js.map