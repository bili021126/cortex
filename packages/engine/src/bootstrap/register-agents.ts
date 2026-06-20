// ============================================================
// @cortex/engine/bootstrap/register-agents —— Agent 注册
// ============================================================

import type { Agent, AgentConfig, AgentType, IFileSystemAdapter, IMemoryStore, IPipelineObserver, MemoryEntry, ReadMode } from "@cortex/shared";
import type { Scheduler } from "../core/scheduler.js";
import type { AgentPool } from "@cortex/scheduler";
import type { MemoryStore } from "@cortex/memory-store";
import type { Toolkit } from "@cortex/platform";
import type { BootstrapResult } from "./factory/index.js";
import type { LlmAdapter } from "@cortex/llm";
import type { EngineConfig } from "@cortex/config";
import { createAgent } from "../components/agent-factory.js";
import type { AgentFactoryConfig } from "../components/agent-factory.js";
import { ButlerAgent } from "../agents/butler-agent.js";
import { registerAllCapabilities } from "../agents/registry.js";
import { resolveLlm, injectStandards, MEMORY_QUERY_REGISTRY } from "./load-config.js";

export async function registerAgents(
  config: BootstrapResult,
  options: {
    llms: Map<string, LlmAdapter>;
    toolkit: Toolkit;
    scheduler: Scheduler;
    pool: AgentPool;
    memory: IMemoryStore | undefined;
    codingStandards: string;
    workspaceRoot?: string;
    filterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[];
    engineConfig?: EngineConfig;
    fs?: IFileSystemAdapter;
    observer?: IPipelineObserver;
  },
): Promise<Map<string, Agent>> {
  // ── 自声明自动注册 ──
  registerAllCapabilities();

  const agents = new Map<string, Agent>();

  for (const def of config.agentDefinitions) {
    const agentType = def.type;

    // 跳过不参与调度的特殊 Agent
    if (agentType === "meta") {
      continue;
    }

    let agent: Agent | undefined;

    switch (agentType) {
      case "butler": {
        if (!options.observer) break;
        const butler = new ButlerAgent(options.observer);
        await butler.wakeup();
        agent = butler as unknown as Agent;
        break;
      }

      default: {
        const strategy = def.memoryQueryStrategy ?? agentType;
        const memoryQuery = MEMORY_QUERY_REGISTRY.get(strategy);
        const factoryConfig: AgentFactoryConfig = {
          type: agentType as AgentType,
          systemPrompt: injectStandards(def.systemPrompt, options.codingStandards),
          memoryEnabled: options.memory != null,
          getMemoryQuery: memoryQuery,
          filterRead: options.filterRead,
        };

        let rawAgent = createAgent(factoryConfig, resolveLlm(options.llms, def.key), options.toolkit, options.memory as MemoryStore);

        // inspector/browser 需注入 workspaceRoot
        if (options.workspaceRoot && (agentType === "inspector" || agentType === "browser")) {
          rawAgent = (rawAgent as unknown as { setWorkspaceRoot(r: string): void }).setWorkspaceRoot
            ? ((rawAgent as unknown as { setWorkspaceRoot(r: string): void }).setWorkspaceRoot(options.workspaceRoot), rawAgent)
            : rawAgent;
        }

        agent = rawAgent;
      }
    }

    if (agent) {
      options.scheduler.register(agentType, agent, def.model);
      options.pool.register({
        type: agentType as AgentType,
        maxInstances: def.maxInstances ?? 1,
      } as AgentConfig);
      agents.set(agentType, agent);
    }
  }

  return agents;
}
