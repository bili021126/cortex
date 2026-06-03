// ============================================================
// @cortex/engine/bootstrap/register-agents —— Agent 注册
// ============================================================

import type { Agent, AgentType, AgentConfig } from "@cortex/shared";
import { Scheduler } from "../core/scheduler.js";
import { AgentPool } from "../core/agent-pool.js";
import { MemoryStore } from "../memory/memory-store.js";
import type { IMemoryStore } from "@cortex/shared";
import { Toolkit } from "../platform/toolkit.js";
import type { BootstrapResult } from "@cortex/factory";
import type { LlmAdapter } from "@cortex/llm";
import type { EngineConfig } from "@cortex/config";
import type { IFileSystemAdapter, MemoryEntry, ReadMode } from "@cortex/shared";
import { createAgent, type AgentFactoryConfig } from "../components/agent-factory.js";
import { createInspectorAgent } from "../agents/inspector-agent.js";
import { createBrowserAgent } from "../agents/browser-agent.js";
import { resolveLlm, injectStandards, MEMORY_QUERY_REGISTRY } from "./load-config.js";

export function registerAgents(
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
  },
): Map<string, Agent> {
  const agents = new Map<string, Agent>();

  for (const def of config.agentDefinitions) {
    const agentType = def.type;

    // 跳过不参与调度的特殊 Agent
    if (agentType === "butler" || agentType === "meta") {
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
