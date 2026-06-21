// ============================================================
// @cortex/engine/bootstrap/register-agents —— Agent 注册
// ============================================================
import { createAgent } from "../components/agent-factory.js";
import { ButlerAgent } from "../agents/butler-agent.js";
import { registerAllCapabilities } from "../agents/registry.js";
import { resolveLlm, injectStandards, MEMORY_QUERY_REGISTRY } from "./load-config.js";
export async function registerAgents(config, options) {
    // ── 自声明自动注册 ──
    registerAllCapabilities();
    const agents = new Map();
    for (const def of config.agentDefinitions) {
        const agentType = def.type;
        // 跳过不参与调度的特殊 Agent
        if (agentType === "meta") {
            continue;
        }
        let agent;
        switch (agentType) {
            case "butler": {
                if (!options.observer)
                    break;
                const butler = new ButlerAgent(options.observer);
                await butler.wakeup();
                agent = butler;
                break;
            }
            default: {
                const strategy = def.memoryQueryStrategy ?? agentType;
                const memoryQuery = MEMORY_QUERY_REGISTRY.get(strategy);
                const factoryConfig = {
                    type: agentType,
                    systemPrompt: injectStandards(def.systemPrompt, options.codingStandards),
                    memoryEnabled: options.memory != null,
                    getMemoryQuery: memoryQuery,
                    filterRead: options.filterRead,
                };
                let rawAgent = createAgent(factoryConfig, resolveLlm(options.llms, def.key), options.toolkit, options.memory);
                // inspector/browser 需注入 workspaceRoot
                if (options.workspaceRoot && (agentType === "inspector" || agentType === "browser")) {
                    rawAgent = rawAgent.setWorkspaceRoot
                        ? (rawAgent.setWorkspaceRoot(options.workspaceRoot), rawAgent)
                        : rawAgent;
                }
                agent = rawAgent;
            }
        }
        if (agent) {
            options.scheduler.register(agentType, agent, def.model);
            options.pool.register({
                type: agentType,
                maxInstances: def.maxInstances ?? 1,
            });
            agents.set(agentType, agent);
        }
    }
    return agents;
}
//# sourceMappingURL=register-agents.js.map