/**
 * 调度三抽象——IScheduleStrategy × ILoopDriver × IExecutionModel
 *
 * 将 Scheduler 的核心行为拆解为三个正交维度，每维可独立替换：
 *
 *   IScheduleStrategy  — 调度策略：节点如何匹配 Agent
 *   ILoopDriver        — 循环方式：执行循环如何推进
 *   IExecutionModel    — 执行范式：单节点如何执行
 *
 * 组合空间：策略 × 驱动 × 范式，理论上 ~75 种组合，实际 5-8 种可行。
 *
 * @module scheduling-types
 * @since v2.9 调度系统组件化与管线可组合
 */

import { type Agent, type IPipelineObserver, type NodeResult, type TaskNode } from "@cortex/shared";
import type { ITaskBoard } from "./task-board.js";
import type { ISchedulerAgentPool } from "./agent-pool.js";
import type { MetaAgent } from "./meta-agent.js";
import type { ReplanManager } from "./replan-manager.js";
import type { EngineConfig } from "@cortex/config";

// ══════════════════════════════════════════════
// IScheduleStrategy —— 调度策略
// ══════════════════════════════════════════════

/**
 * 调度策略：决定任务节点由哪个 Agent 执行。
 *
 * 典型实现：
 *   - TagMatchingStrategy（默认）：按 AGENT_TAGS 标签匹配
 *   - RoundRobinStrategy：轮转分配，均衡负载
 *   - PriorityFirstStrategy：高优先级节点优先
 *   - SkillBasedStrategy：按技能模板匹配（Core-2 预留）
 */
export interface IScheduleStrategy {
  /** 策略标识名（用于日志/调试） */
  readonly name: string;

  /**
   * 为单个节点查找最佳匹配的 Agent 类型。
   * @returns Agent 类型名，无匹配时返回 null
   */
  findMatchingAgent(node: TaskNode, agents: Map<string, Agent>): string | null;

  /**
   * 为多视角节点查找所有匹配的 Agent 类型。
   * @returns 所有匹配的 Agent 类型列表
   */
  findAllMatchingAgents(node: TaskNode, agents: Map<string, Agent>): string[];
}

// ══════════════════════════════════════════════
// ILoopDriver —— 循环方式
// ══════════════════════════════════════════════

/** 循环驱动上下文——包含执行一轮所需的所有依赖 */
export interface LoopContext {
  board: ITaskBoard;
  pool: ISchedulerAgentPool;
  observer: IPipelineObserver;
  agents: Map<string, Agent>;
  models: Map<string, string>;
  metaAgent?: MetaAgent;
  replanManager: ReplanManager;
  config: Required<EngineConfig>;
  /** 当前使用的调度策略 */
  strategy: IScheduleStrategy;
  /** 当前使用的执行范式 */
  executionModel: IExecutionModel;
}

/** 循环驱动执行结果 */
export interface LoopResult {
  completed: number;
  failed: number;
  results: NodeResult[];
}

/**
 * 循环方式：控制执行循环如何推进。
 *
 * 典型实现：
 *   - TopologicalLayeredDriver（默认）：拓扑排序 → 逐层并行
 *   - SequentialDriver：严格顺序执行，一个接一个
 *   - WaveDriver：波浪式推进（design → code → review → verify）
 *   - ContinuousDriver：持续改进直到收敛（Core-2 预留）
 */
export interface ILoopDriver {
  /** 驱动标识名 */
  readonly name: string;

  /**
   * 执行完整调度循环。
   * @returns 循环执行结果
   */
  run(ctx: LoopContext): Promise<LoopResult>;
}

// ══════════════════════════════════════════════
// IExecutionModel —— 执行范式
// ══════════════════════════════════════════════

/** 执行上下文——单节点执行所需的所有依赖 */
export interface ExecutionContext {
  node: TaskNode;
  agents: Map<string, Agent>;
  models: Map<string, string>;
  board: ITaskBoard;
  pool: ISchedulerAgentPool;
  observer: IPipelineObserver;
  strategy: IScheduleStrategy;
  /** 是否为测试环境（绕过确认门） */
  isTestEnv: boolean;
}

/**
 * 执行范式：控制单个任务节点的执行方式。
 *
 * 典型实现：
 *   - PipelineModel（默认）：Claim → Spawn → [Skill] → Execute → Cleanup
 *   - SimpleExecuteModel：跳过管线，直接执行（适合简单/测试场景）
 *   - ReActModel：Reason → Act → Observe 循环（Core-2 预留）
 *   - ReflexionModel：Execute → Evaluate → Reflect → Retry（Core-2 预留）
 */
export interface IExecutionModel {
  /** 范式标识名 */
  readonly name: string;

  /**
   * 执行单个节点（单视角）。
   * @returns 节点执行结果
   */
  dispatchSingle(ctx: ExecutionContext): Promise<NodeResult>;

  /**
   * 执行单个节点（多视角——多个 Agent 并行）。
   * @returns 聚合后的节点执行结果
   */
  dispatchMulti(ctx: ExecutionContext): Promise<NodeResult>;
}

// ══════════════════════════════════════════════
// CompositeScheduler 配置
// ══════════════════════════════════════════════

/** 组合式调度器配置 */
export interface CompositeSchedulerConfig {
  /** 调度策略（默认 TagMatchingStrategy） */
  strategy?: IScheduleStrategy;
  /** 循环方式（默认 TopologicalLayeredDriver） */
  loopDriver?: ILoopDriver;
  /** 执行范式（默认 PipelineModel） */
  executionModel?: IExecutionModel;
}
