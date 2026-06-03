// ============================================================
// @cortex/engine/bootstrap/assemble —— 最终组装 BootstrapResult
// ============================================================

import type { Agent } from "@cortex/shared";
import { ButlerAgent } from "../agents/butler-agent.js";
import type { IScheduler } from "../core/scheduler.js";
import type { IAgentPool } from "../core/agent-pool.js";
import type { IPipelineObserver } from "@cortex/shared";
import type { ITaskBoard } from "../core/task-board.js";
import type { ConfirmGate } from "../core/confirm-gate.js";
import type { CLIAdapter } from "../platform/cli-adapter.js";
import type { IMemoryStore } from "@cortex/shared";
import type { MetaAgent } from "../core/meta-agent.js";
import type { StrategistAgent } from "../agents/strategist-agent.js";
import type { SkillRegistry } from "../registry/skill-registry.js";
import type { SkillExecutor } from "../core/skill-executor.js";
import type { ConsistencyLayer } from "../consistency/consistency-layer.js";
import type { BootstrapResult } from "@cortex/factory";

export interface BootstrapEngineResult {
  scheduler: IScheduler;
  pool: IAgentPool;
  observer: IPipelineObserver;
  board: ITaskBoard;
  gate: ConfirmGate;
  cliAdapter: CLIAdapter;
  memory: IMemoryStore | undefined;
  metaAgent: MetaAgent;
  butler: ButlerAgent;
  strategists: Map<string, StrategistAgent>;
  skillRegistry: SkillRegistry;
  skillExecutor: SkillExecutor;
  config: BootstrapResult;
  agents: Map<string, Agent>;
  consistencyLayer?: ConsistencyLayer;
  /** 优雅关闭——逆序释放所有引擎资源 */
  shutdown(): Promise<void>;
}

export interface AssembleInput {
  scheduler: IScheduler;
  pool: IAgentPool;
  observer: IPipelineObserver;
  board: ITaskBoard;
  gate: ConfirmGate;
  cliAdapter: CLIAdapter;
  memory: IMemoryStore | undefined;
  metaAgent: MetaAgent;
  strategists: Map<string, StrategistAgent>;
  skillRegistry: SkillRegistry;
  skillExecutor: SkillExecutor;
  config: BootstrapResult;
  agents: Map<string, Agent>;
  consistencyLayer?: ConsistencyLayer;
}

export function assemble(input: AssembleInput): BootstrapEngineResult {
  const butler = new ButlerAgent(input.observer);

  const shutdown = async (): Promise<void> => {
    // 逆序释放资源——各组件以 best-effort 关闭，未实现的方法静默跳过
    try { (input.scheduler as any).stop?.(); } catch { /* best-effort */ }
    try { (input.pool as any).destroyAll?.(); } catch { /* best-effort */ }
    try { (input.observer as any).clear?.(); } catch { /* best-effort */ }
    try { await input.memory?.close(); } catch { /* best-effort */ }
    try { (input.gate as any).dispose?.(); } catch { /* best-effort */ }
    try { input.cliAdapter.close?.(); } catch { /* best-effort */ }
  };

  return {
    scheduler: input.scheduler,
    pool: input.pool,
    observer: input.observer,
    board: input.board,
    gate: input.gate,
    cliAdapter: input.cliAdapter,
    memory: input.memory,
    metaAgent: input.metaAgent,
    butler,
    strategists: input.strategists,
    skillRegistry: input.skillRegistry,
    skillExecutor: input.skillExecutor,
    config: input.config,
    agents: input.agents,
    consistencyLayer: input.consistencyLayer,
    shutdown,
  };
}
