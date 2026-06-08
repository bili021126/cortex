/**
 * CompositeScheduler —— 组合式调度器。
 *
 * 将调度行为拆解为三个可替换维度：
 *   IScheduleStrategy  — 节点→Agent 匹配策略
 *   ILoopDriver        — 执行循环推进方式
 *   IExecutionModel    — 单节点执行范式
 *
 * 实现 IScheduler 接口，可作为现有 Scheduler 的 drop-in 替换。
 *
 * @module composite-scheduler
 * @since v2.9 调度系统组件化与管线可组合
 */

import { type Agent, type ExecutionReport, type IPipelineObserver } from "@cortex/shared";
import type { ITaskBoard } from "./task-board.js";
import type { ISchedulerAgentPool } from "./agent-pool.js";
import type { MetaAgent } from "./meta-agent.js";
import { ReplanManager } from "./replan-manager.js";
import { resolveConfig, type EngineConfig } from "@cortex/config";
import type { IScheduler } from "./scheduler.js";

import type {
  IScheduleStrategy,
  ILoopDriver,
  IExecutionModel,
  CompositeSchedulerConfig,
  LoopContext,
} from "./scheduling-types.js";
import { PipelineModel, TagMatchingStrategy, TopologicalLayeredDriver } from "./scheduling-implementations.js";

/**
 * CompositeScheduler —— 组合式调度器。
 *
 * 将 Scheduler 的三个维度（策略/驱动/范式）拆解为可替换组件，
 * 同时保持与现有 Scheduler 完全兼容的 IScheduler 接口。
 *
 * 默认行为（不传 config）与现有 Scheduler 完全一致：
 *   - TagMatchingStrategy + TopologicalLayeredDriver + PipelineModel
 *
 * @example
 * // 默认行为（与 Scheduler 一致）
 * const s = new CompositeScheduler(board, pool, observer, metaAgent);
 *
 * @example
 * // 实验：顺序执行 + 简化范式
 * const s = new CompositeScheduler(board, pool, observer, metaAgent, engineConfig, {
 *   loopDriver: new SequentialDriver(),
 *   executionModel: new SimpleExecuteModel(),
 * });
 */
export class CompositeScheduler implements IScheduler {
  private agents = new Map<string, Agent>();
  private models = new Map<string, string>();
  private readonly replanManager: ReplanManager;
  private readonly config: Required<EngineConfig>;

  // 三抽象组件
  readonly strategy: IScheduleStrategy;
  readonly loopDriver: ILoopDriver;
  readonly executionModel: IExecutionModel;

  constructor(
    private readonly board: ITaskBoard,
    private readonly pool: ISchedulerAgentPool,
    private readonly observer: IPipelineObserver,
    private readonly metaAgent?: MetaAgent,
    engineConfig?: EngineConfig,
    schedulerConfig?: CompositeSchedulerConfig,
  ) {
    this.config = resolveConfig(engineConfig);
    this.replanManager = new ReplanManager(board, observer, metaAgent, this.config);

    this.strategy = schedulerConfig?.strategy ?? new TagMatchingStrategy();
    this.loopDriver = schedulerConfig?.loopDriver ?? new TopologicalLayeredDriver();
    this.executionModel = schedulerConfig?.executionModel ?? new PipelineModel();
  }

  /** 注册一个 AgentRunner 及其所用模型 */
  register(agentType: string, agent: Agent, model: string): void {
    this.agents.set(agentType, agent);
    this.models.set(agentType, model);
  }

  /**
   * 执行 TaskBoard 上全部节点。
   * 委托给 ILoopDriver.run()，由驱动控制循环推进方式。
   */
  async executeAll(): Promise<ExecutionReport> {
    const startTime = Date.now();

    const loopCtx: LoopContext = {
      board: this.board,
      pool: this.pool,
      observer: this.observer,
      agents: this.agents,
      models: this.models,
      metaAgent: this.metaAgent,
      replanManager: this.replanManager,
      config: this.config,
      strategy: this.strategy,
      executionModel: this.executionModel,
    };

    const loopResult = await this.loopDriver.run(loopCtx);

    // 汇总 ExecutionReport
    const durationMs = Date.now() - startTime;
    const allNodes = this.board.getAllNodes();

    this.replanManager.reset();

    return {
      totalNodes: allNodes.length,
      completed: loopResult.completed,
      failed: loopResult.failed,
      results: loopResult.results,
      durationMs,
    };
  }
}
