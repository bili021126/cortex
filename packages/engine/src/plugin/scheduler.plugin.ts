// ============================================================
// @cortex/engine/plugin/scheduler.plugin
//
// Scheduler 插件——依赖全部核心插件。
// 拓扑排序任务树 → 逐层并行分发给 Agent → 产出 ExecutionReport。
// Agent 注册（registerAgents）逻辑内建为 start() 的一部分。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================

import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import type { Agent, AgentType, Disposable, MemoryEntry, ReadMode } from "@cortex/shared";
import { Scheduler } from "../core/scheduler.js";
import { createAgent, type AgentFactoryConfig } from "../components/agent-factory.js";
import { createInspectorAgent } from "../agents/inspector-agent.js";
import { createBrowserAgent } from "../agents/browser-agent.js";
import { ButlerAgent } from "../agents/butler-agent.js";
import type { MemoryStore } from "../memory/memory-store.js";
import type { Toolkit } from "../platform/toolkit.js";
import type { PipelineObserver } from "../core/pipeline-observer.js";
import type { LlmAdapter } from "@cortex/llm";
import { resolveLlm, injectStandards, MEMORY_QUERY_REGISTRY } from "../bootstrap/load-config.js";
import {
  registerAgentFactory,
  getAgentFactory,
} from "./agent-factory-registry.js";

export class SchedulerPlugin implements EnginePlugin {
  readonly name = "scheduler";
  readonly dependencies = [
    "taskBoard",
    "agentPool",
    "pipelineObserver",
    "metaAgent",
    "memoryStore",
  ];

  private instance!: Scheduler;
  private _agents = new Map<string, Agent>();
  private _butler?: ButlerAgent;

  async init(ctx: PluginContext): Promise<void> {
    const board = ctx.get<TaskBoardPlugin>("taskBoard").getInstance();
    const pool = ctx.get<AgentPoolPlugin>("agentPool").getInstance();
    const observer = ctx.get<PipelineObserverPlugin>("pipelineObserver").getInstance();
    const metaAgent = ctx.get<MetaAgentPlugin>("metaAgent").getInstance();
    const memoryPlugin = ctx.get<MemoryStorePlugin>("memoryStore");

    this.instance = new Scheduler(
      board,
      pool,
      observer,
      metaAgent,
      ctx.config,
    );

    // 接线 MemoryStore → Scheduler
    if (memoryPlugin) {
      this.instance.setMemoryStore(memoryPlugin.getInstance());
    }
  }

  async start(): Promise<void> {
    // Agent 注册在 PluginLoader postInit 阶段执行（需要 Toolkit + 全部依赖就绪）
  }

  async stop(): Promise<void> {
    (this.instance as unknown as Disposable).stop?.();
  }

  health(): PluginHealth {
    return this.instance ? "healthy" : "dead";
  }

  getInstance(): Scheduler {
    return this.instance;
  }

  getAgents(): Map<string, Agent> {
    return this._agents;
  }

  getButler(): ButlerAgent | undefined {
    return this._butler;
  }

  /**
   * 注册全部 Agent——由 PluginLoader 在全部插件 init 后调用。
   * 等同于原 bootstrap 中的 registerAgents() 逻辑。
   */
  async registerAllAgents(ctx: PluginContext): Promise<Map<string, Agent>> {
    const { llms, toolkit, codingStandards, factoryConfig } = ctx.externals;
    const observer = ctx.get<PipelineObserverPlugin>("pipelineObserver").getInstance();
    const memory = ctx.get<MemoryStorePlugin>("memoryStore").getInstance();
    const filterRead = ctx.get<ConsistencyLayerPlugin>("consistencyLayer").getFilterRead();

    // 注册表注入已在 bootstrap 阶段完成（bootstrap-engine.ts §2），此处不再重复调用

    // ── 注册特殊 Agent 工厂（配置驱动：新增 Agent 类型在别处 registerAgentFactory 即可）──
    _registerBuiltinAgentFactories(ctx, observer, toolkit, memory as MemoryStore, codingStandards, filterRead, llms);

    for (const def of factoryConfig.agentDefinitions) {
      const agentType = def.type;

      // 跳过不参与调度的特殊 Agent
      if (agentType === "meta" || agentType === "strategist") {
        continue;
      }

      let agent: Agent | undefined;

      // 配置驱动：从工厂注册表获取工厂（特殊 Agent 已自注册），fallback 到默认工厂
      const factory = getAgentFactory(agentType);
      if (factory) {
        agent = await factory(def, ctx);
        // butler：存储引用但不注册为可调度 Agent
        if (agentType === "butler" && agent) {
          this._butler = agent as unknown as ButlerAgent;
          continue;
        }
      } else {
        // 默认工厂：通用 createAgent 逻辑
        const llmAdapter = resolveLlm(llms, def.key);
        const memoryQuery = MEMORY_QUERY_REGISTRY.get(agentType);
        const factoryConf: AgentFactoryConfig = {
          type: agentType as AgentType,
          systemPrompt: injectStandards(def.systemPrompt, codingStandards),
          filterRead,
          memoryEnabled: true,
          getMemoryQuery: memoryQuery ?? undefined,
        };
        agent = createAgent(factoryConf, llmAdapter as LlmAdapter, toolkit, memory as MemoryStore);
      }

      if (agent) {
        try {
          await agent.wakeup();
           
        } catch (e) {
          console.warn(
            `[Scheduler] ${agentType} Agent wakeup 失败（将跳过注册）:`,
            e instanceof Error ? e.message : String(e),
          );
          continue;
        }
        const modelKey = def.key ?? "default";
        this.instance.register(agentType, agent, modelKey);
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
function _registerBuiltinAgentFactories(
  ctx: PluginContext,
  observer: PipelineObserver,
  toolkit: Toolkit,
  memory: MemoryStore,
  codingStandards: string,
  filterRead: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[],
  llms: Map<string, LlmAdapter>,
): void {
  registerAgentFactory("inspector", async (def, c) => {
    const inspAgent = createInspectorAgent(
      resolveLlm(llms, def.key),
      toolkit,
      memory,
      c.config,
      injectStandards(def.systemPrompt, codingStandards),
      filterRead,
    );
    if (c.workspaceRoot) inspAgent.setWorkspaceRoot(c.workspaceRoot);
    return inspAgent;
  });

  registerAgentFactory("browser", async (def, c) => {
    const brwAgent = createBrowserAgent(
      resolveLlm(llms, def.key),
      toolkit,
      memory,
      injectStandards(def.systemPrompt, codingStandards),
      filterRead,
    );
    if (c.workspaceRoot) brwAgent.setWorkspaceRoot(c.workspaceRoot);
    return brwAgent;
  });

  registerAgentFactory("butler", async (_def, _c) => {
    // butler 直接创建——不通过 createAgent，无需工厂参数
    // 使用闭包捕获的 observer（而非 c.observer，后者为空存根）
    return new ButlerAgent(observer) as unknown as Agent;
  });
}

// 前向声明插件类型
import type { TaskBoardPlugin } from "./task-board.plugin.js";
import type { AgentPoolPlugin } from "./agent-pool.plugin.js";
import type { PipelineObserverPlugin } from "./pipeline-observer.plugin.js";
import type { MetaAgentPlugin } from "./meta-agent.plugin.js";
import type { MemoryStorePlugin } from "./memory-store.plugin.js";
import type { ConsistencyLayerPlugin } from "./consistency-layer.plugin.js";

// 自注册
import { PluginLoader } from "./plugin-loader.js";
PluginLoader.register("scheduler", SchedulerPlugin);
