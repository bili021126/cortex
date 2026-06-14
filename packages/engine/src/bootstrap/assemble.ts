// ============================================================
// @cortex/engine/bootstrap/assemble —— 最终组装 BootstrapResult
// ============================================================

import type { Agent, IMemoryStore, IPipelineObserver } from "@cortex/shared";
import { ButlerAgent } from "../agents/butler-agent.js";
import type { IScheduler, IAgentPool, ITaskBoard, ConfirmGate } from "@cortex/scheduler";
import type { CLIAdapter } from "@cortex/platform";
import type { MetaAgent } from "../core/meta-agent.js";
import type { StrategistAgent } from "../agents/strategist-agent.js";
import type { SkillRegistry } from "../registry/skill-registry.js";
import type { ConsistencyLayer } from "@cortex/consistency";
import type { BootstrapResult } from "@cortex/factory";
import type { LifecycleManager } from "../lifecycle/lifecycle-manager.js";

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
  config: BootstrapResult;
  agents: Map<string, Agent>;
  consistencyLayer?: ConsistencyLayer;
  /** LifecycleManager —— 管理非插件 ILifecycle 组件的生命周期 */
  lifecycleManager?: LifecycleManager;
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
  config: BootstrapResult;
  agents: Map<string, Agent>;
  consistencyLayer?: ConsistencyLayer;
}

export function assemble(input: AssembleInput): BootstrapEngineResult {
  const butler = new ButlerAgent(input.observer);

  const shutdown = async (): Promise<void> => {
    // 逆序释放资源——各组件以 best-effort 关闭，未实现的方法静默跳过
    try { (input.scheduler as unknown as { stop?(): void }).stop?.(); } catch { /* best-effort */ }
    try { (input.pool as unknown as { destroyAll?(): void }).destroyAll?.(); } catch { /* best-effort */ }
    try { (input.observer as unknown as { clear?(): void }).clear?.(); } catch { /* best-effort */ }
    try { await input.memory?.close(); } catch { /* best-effort */ }
    try { (input.gate as unknown as { dispose?(): void }).dispose?.(); } catch { /* best-effort */ }
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
    config: input.config,
    agents: input.agents,
    consistencyLayer: input.consistencyLayer,
    shutdown,
  };
}
