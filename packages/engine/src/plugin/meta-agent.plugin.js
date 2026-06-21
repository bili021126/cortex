// ============================================================
// @cortex/engine/plugin/meta-agent.plugin
//
// MetaAgent 插件——依赖 PipelineObserver。
// 战术中枢：拆解意图 → 任务树 → 重规划仲裁 → 多 Agent 聚合。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================
import { MetaAgent } from "../core/meta-agent.js";
import { resolveLlm } from "../bootstrap/load-config.js";
export class MetaAgentPlugin {
    name = "metaAgent";
    dependencies = ["pipelineObserver"];
    instance;
    async init(ctx) {
        const observer = ctx.get("pipelineObserver").getInstance();
        const llmMap = ctx.externals.llms;
        const fConfig = ctx.externals.factoryConfig;
        const metaDef = fConfig.agentDefinitions.find((d) => d.type === "meta");
        const llm = resolveLlm(llmMap, metaDef?.key);
        this.instance = new MetaAgent(llm, undefined, // skillRegistry——SkillSystem 插件启动后通过 setSkillRegistry 注入
        metaDef?.planningPrompt, metaDef?.replanPrompt, observer, ctx.workspaceRoot);
    }
    async start() { }
    async stop() {
        this.instance.shutdown?.();
    }
    health() {
        return this.instance ? "healthy" : "dead";
    }
    getInstance() {
        return this.instance;
    }
}
//# sourceMappingURL=meta-agent.plugin.js.map