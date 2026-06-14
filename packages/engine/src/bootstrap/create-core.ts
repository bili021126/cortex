// ============================================================
// @cortex/engine/bootstrap/create-core —— 引擎核心组件创建
// ============================================================

import { CLIAdapter, type Toolkit, type ToolMeta } from "@cortex/platform";
import { Scheduler } from "../core/scheduler.js";
import { TaskBoard, AgentPool, PipelineObserver, ConfirmGate } from "@cortex/scheduler";
import { MetaAgent } from "../core/meta-agent.js";
import { StrategistAgent } from "../agents/strategist-agent.js";
import type { LlmAdapter } from "@cortex/llm";
import type { BootstrapResult } from "@cortex/factory";
import type { EngineConfig } from "@cortex/config";
import { resolveLlm, injectStandards, injectRegistryFromConfig } from "./load-config.js";

// ─── 中间类型 ────────────────────────────────────────

export interface EngineCoreComponents {
  observer: PipelineObserver;
  pool: AgentPool;
  gate: ConfirmGate;
  cliAdapter: CLIAdapter;
  board: TaskBoard;
}

export interface SpecialAgents {
  metaAgent: MetaAgent;
  strategists: Map<string, StrategistAgent>;
}

// ════════════════════════════════════════════════════════════
// 工厂: createEngineCore — 创建引擎核心组件
// ════════════════════════════════════════════════════════════

export function createEngineCore(toolkit: Toolkit): EngineCoreComponents {
  const observer = new PipelineObserver();
  const pool = new AgentPool();
  pool.setObserver(observer);
  const gate = new ConfirmGate();
  const cliAdapter = new CLIAdapter();
  gate.setBridge(cliAdapter);
  toolkit.setGate(gate);
  const board = new TaskBoard();
  board.setObserver(observer);
  return { observer, pool, gate, cliAdapter, board };
}

// ════════════════════════════════════════════════════════════
// 工厂: createSpecialAgents — 创建特殊 Agent
// ════════════════════════════════════════════════════════════

export async function createSpecialAgents(
  config: BootstrapResult,
  llms: Map<string, LlmAdapter>,
  codingStandards: string,
  observer?: PipelineObserver,
  workspaceRoot?: string,
): Promise<SpecialAgents> {
  // MetaAgent（甘雨）
  const metaDef = config.agentDefinitions.find((d) => d.type === "meta");
  const metaAgent = new MetaAgent(
    resolveLlm(llms, metaDef?.key),
    undefined,
    metaDef?.planningPrompt,
    metaDef?.replanPrompt,
    observer, // v2.5.41: 注入管线——MetaAgent 订阅事件以获取执行层信息
    workspaceRoot, // v2.5.41: 工作区边界校验——甘雨必须知道当前工作区路径
  );

  // StrategistAgent（钟离 + 霜凝）
  const strategistDefs = config.agentDefinitions.filter((d) => d.type === "strategist");
  const strategists = new Map<string, StrategistAgent>();
  for (const def of strategistDefs) {
    const agent = new StrategistAgent(resolveLlm(llms, def.key), injectStandards(def.systemPrompt, codingStandards));
    await agent.wakeup();
    strategists.set(def.id, agent);
  }

  return { metaAgent, strategists };
}

// ════════════════════════════════════════════════════════════
// 工厂: configAndInject — 注入配置
// ════════════════════════════════════════════════════════════

export function configAndInject(
  config: BootstrapResult,
  toolkit: Toolkit,
): void {
  injectRegistryFromConfig(config.agentDefinitions);
  if (config.tools) {
    toolkit.setToolMeta(config.tools as Record<string, ToolMeta>);
  }
}

// ════════════════════════════════════════════════════════════
// 工厂: createScheduler — 创建调度器
// ════════════════════════════════════════════════════════════

export function createScheduler(
  board: TaskBoard,
  pool: AgentPool,
  observer: PipelineObserver,
  metaAgent: MetaAgent,
  engineConfig?: EngineConfig,
): Scheduler {
  return new Scheduler(board, pool, observer, metaAgent, engineConfig);
}
