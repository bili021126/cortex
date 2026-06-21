// ============================================================
// @cortex/engine/plugin/scheduler.plugin
//
// Scheduler 插件——依赖全部核心插件。
// 拓扑排序任务树 → 逐层并行分发给 Agent → 产出 ExecutionReport。
// Agent 注册（registerAgents）逻辑内建为 start() 的一部分。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================
import { Scheduler } from "../core/scheduler.js";
import { createAgent } from "../components/agent-factory.js";
import { createInspectorAgent } from "../agents/inspector-agent.js";
import { createBrowserAgent } from "../agents/browser-agent.js";
import { ButlerAgent } from "../agents/butler-agent.js";
import { resolveLlm, injectStandards, MEMORY_QUERY_REGISTRY } from "../bootstrap/load-config.js";
import { registerAgentFactory, getAgentFactory, } from "./agent-factory-registry.js";
export class SchedulerPlugin {
    name = "scheduler";
    dependencies = [
        "taskBoard",
        "agentPool",
        "pipelineObserver",
        "metaAgent",
        "memoryStore",
    ];
    instance;
    _agents = new Map();
    _butler;
    async init(ctx) {
        const board = ctx.get("taskBoard").getInstance();
        const pool = ctx.get("agentPool").getInstance();
        const observer = ctx.get("pipelineObserver").getInstance();
        const metaAgent = ctx.get("metaAgent").getInstance();
        const memoryPlugin = ctx.get("memoryStore");
        this.instance = new Scheduler(board, pool, observer, metaAgent, ctx.config);
        // 接线 MemoryStore → Scheduler
        if (memoryPlugin) {
            this.instance.setMemoryStore(memoryPlugin.getInstance());
        }
    }
    async start() {
        // Agent 注册在 PluginLoader postInit 阶段执行（需要 Toolkit + 全部依赖就绪）
    }
    async stop() {
        this.instance.stop?.();
    }
    health() {
        return this.instance ? "healthy" : "dead";
    }
    getInstance() {
        return this.instance;
    }
    getAgents() {
        return this._agents;
    }
    getButler() {
        return this._butler;
    }
    /**
     * 注册全部 Agent——由 PluginLoader 在全部插件 init 后调用。
     * 等同于原 bootstrap 中的 registerAgents() 逻辑。
     */
    async registerAllAgents(ctx) {
        const llmMap = ctx.externals.llms;
        const tk = ctx.externals.toolkit;
        const { codingStandards } = ctx.externals;
        const fConfig = ctx.externals.factoryConfig;
        const observer = ctx.get("pipelineObserver").getInstance();
        const memory = ctx.get("memoryStore").getInstance();
        const filterRead = ctx.get("consistencyLayer").getFilterRead();
        const pool = ctx.get("agentPool").getInstance();
        // 注册表注入已在 bootstrap 阶段完成（bootstrap-engine.ts §2），此处不再重复调用
        // ── 注册特殊 Agent 工厂（配置驱动：新增 Agent 类型在别处 registerAgentFactory 即可）──
        _registerBuiltinAgentFactories(ctx, observer, tk, memory, codingStandards, filterRead, llmMap);
        for (const def of fConfig.agentDefinitions) {
            const agentType = def.type;
            // 跳过不参与调度的特殊 Agent
            if (agentType === "meta" || agentType === "strategist") {
                continue;
            }
            let agent;
            // 配置驱动：从工厂注册表获取工厂（特殊 Agent 已自注册），fallback 到默认工厂
            const factory = getAgentFactory(agentType);
            if (factory) {
                agent = await factory(def, ctx);
                // butler：存储引用但不注册为可调度 Agent
                if (agentType === "butler" && agent) {
                    this._butler = agent;
                    continue;
                }
            }
            else {
                // 默认工厂：通用 createAgent 逻辑
                const llmAdapter = resolveLlm(llmMap, def.key);
                const memoryQuery = MEMORY_QUERY_REGISTRY.get(agentType);
                const factoryConf = {
                    type: agentType,
                    systemPrompt: injectStandards(def.systemPrompt, codingStandards),
                    filterRead,
                    memoryEnabled: true,
                    getMemoryQuery: memoryQuery ?? undefined,
                };
                agent = createAgent(factoryConf, llmAdapter, tk, memory);
            }
            if (agent) {
                try {
                    await agent.wakeup();
                }
                catch (e) {
                    console.warn(`[Scheduler] ${agentType} Agent wakeup 失败（将跳过注册）:`, e instanceof Error ? e.message : String(e));
                    continue;
                }
                this.instance.register(agentType, agent, def.model);
                pool.register({
                    type: agentType,
                    maxInstances: def.maxInstances ?? 1,
                });
                this._agents.set(agentType, agent);
            }
        }
        return this._agents;
    }
}
// ── 内置 Agent 工厂注册 ──────────────────────────────────
/**
 * 注册内置特殊 Agent 工厂。
 * 每个工厂闭包捕获所需的依赖（observer/toolkit/memory 等），
 * 运行时按 agentType 查找执行。
 *
 * 新增 Agent 类型：在其他模块调用 registerAgentFactory(type, factory) 即可，
 * 无需修改本文件。
 */
function _registerBuiltinAgentFactories(ctx, observer, toolkit, memory, codingStandards, filterRead, llms) {
    registerAgentFactory("inspector", async (def, c) => {
        const inspAgent = createInspectorAgent(resolveLlm(llms, def.key), toolkit, memory, c.config, injectStandards(def.systemPrompt, codingStandards), filterRead);
        if (c.workspaceRoot)
            inspAgent.setWorkspaceRoot(c.workspaceRoot);
        return inspAgent;
    });
    registerAgentFactory("browser", async (def, c) => {
        const brwAgent = createBrowserAgent(resolveLlm(llms, def.key), toolkit, memory, injectStandards(def.systemPrompt, codingStandards), filterRead);
        if (c.workspaceRoot)
            brwAgent.setWorkspaceRoot(c.workspaceRoot);
        return brwAgent;
    });
    registerAgentFactory("butler", async (_def, _c) => {
        // butler 直接创建——不通过 createAgent，无需工厂参数
        // 使用闭包捕获的 observer（而非 c.observer，后者为空存根）
        return new ButlerAgent(observer);
    });
}
//# sourceMappingURL=scheduler.plugin.js.map