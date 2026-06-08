// ============================================================
// @cortex/engine/bootstrap/register-agents —— Agent 注册
// ============================================================

import { type Agent, type AgentConfig, type AgentType, type IFileSystemAdapter, type IMemoryStore, type IPipelineObserver, type MemoryEntry, type ReadMode } from "@cortex/shared";
import type { Scheduler } from "../core/scheduler.js";
import type { AgentPool } from "../core/agent-pool.js";
import type { MemoryStore } from "../memory/memory-store.js";
import type { Toolkit } from "../platform/toolkit.js";
import type { BootstrapResult } from "@cortex/factory";
import type { LlmAdapter } from "@cortex/llm";
import type { EngineConfig } from "@cortex/config";
import { createAgent, type AgentFactoryConfig } from "../components/agent-factory.js";
import { createInspectorAgent } from "../agents/inspector-agent.js";
import { createBrowserAgent } from "../agents/browser-agent.js";
import { ButlerAgent } from "../agents/butler-agent.js";
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
  const agents = new Map<string, Agent>();

  for (const def of config.agentDefinitions) {
    const agentType = def.type;

    // 跳过不参与调度的特殊 Agent
    if (agentType === "meta") {
      continue;
    }

    let agent: Agent | undefined;

    switch (agentType) {
      case "inspector": {
        const inspAgent = createInspectorAgent(
          resolveLlm(options.llms, def.key),
          options.toolkit,
          options.memory as MemoryStore,
          options.engineConfig,
          injectStandards(def.systemPrompt, options.codingStandards),
          options.filterRead,
        );
        if (options.workspaceRoot) inspAgent.setWorkspaceRoot(options.workspaceRoot);
        agent = inspAgent;
        break;
      }

      case "browser": {
        const brwAgent = createBrowserAgent(
          resolveLlm(options.llms, def.key),
          options.toolkit,
          options.memory as MemoryStore,
          injectStandards(def.systemPrompt, options.codingStandards),
          options.filterRead,
        );
        if (options.workspaceRoot) brwAgent.setWorkspaceRoot(options.workspaceRoot);
        agent = brwAgent;
        break;
      }

      case "butler": {
        if (!options.observer) break;
        const butler = new ButlerAgent(options.observer);
        // Butler 不调用 LLM、不使用 toolkit，仅旁听管线事件
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
        agent = createAgent(factoryConfig, resolveLlm(options.llms, def.key), options.toolkit, options.memory as MemoryStore);
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
