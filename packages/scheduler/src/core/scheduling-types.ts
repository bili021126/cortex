/**
 * 调度四抽象——IScheduleStrategy × ILoopDriver × IExecutionModel × IModelRouter
 *
 * 将 Scheduler 的核心行为拆解为四个正交维度，每维可独立替换：
 *
 *   IScheduleStrategy  — 调度策略：节点如何匹配 Agent
 *   ILoopDriver        — 循环方式：执行循环如何推进
 *   IExecutionModel    — 执行范式：单节点如何执行
 *   IModelRouter       — 模型路由：任务如何选择 LLM 模型
 *
 * 组合空间：策略 × 驱动 × 范式 × 路由，理论上数百种组合。
 *
 * @module scheduling-types
 * @since v2.9 调度系统组件化与管线可组合
 */

import type { Agent, ExecutionReport, IPipelineObserver, NodeResult, TaskNode } from "@cortex/shared";
import type { ITaskBoard } from "./task-board.js";
import type { ISchedulerAgentPool } from "./agent-pool.js";
import type { IReplanProvider, ReplanManager } from "./replan-manager.js";
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
  /** 可选——重规划提供者（如 MetaAgent 适配器），缺则 replan 静默排空 */
  replanProvider?: IReplanProvider;
  replanManager: ReplanManager;
  config: Required<EngineConfig>;
  /** 当前使用的调度策略 */
  strategy: IScheduleStrategy;
  /** 当前使用的执行范式 */
  executionModel: IExecutionModel;
  /**
   * 可选——自定义节点分发回调。
   * 提供时 loopDriver 优先使用此回调分发节点，而非走 executionModel.dispatchSingle/Multi。
   * 用于经典 Scheduler（含 RLM 递归拆解管线）注入其完整 dispatch 逻辑。
   */
  dispatchNode?: (node: TaskNode) => Promise<NodeResult>;
  /** 可选——模型路由器。提供时 dispatch 管线通过此路由动态选择 LLM 模型，否则使用 Agent 注册时的默认模型 */
  modelRouter?: IModelRouter;
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
 *   - WaveDriver：波浪式推进（design → implement → review → verify）
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
 *   - PipelineModel（默认）：Claim → Spawn → Execute → BoundaryGuard → Cleanup
 *   - SimpleExecuteModel：跳过管线，直接执行（适合简单/测试场景）
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
// IModelRouter —— 模型路由
// ══════════════════════════════════════════════

/** 模型能力等级 */
export type ModelTier = 'fast' | 'standard' | 'thinking';

/**
 * 模型路由：根据任务复杂度将节点分发到不同能力的 LLM 模型。
 *
 * 典型实现：
 *   - FixedModelRouter（默认）：始终返回 Agent 注册时的默认模型
 *   - SemanticModelRouter：语义路由——推荐标注/LLM 分类 + Agent floor 保护
 *
 * 设计动机（2026H1 全球模型生态）：
 *   - 快模型（Gemini Flash / DeepSeek Instant / GPT-5.5 Instant）：~400 tokens/s，适合简单确认、改注释
 *   - 标准模型（Sonnet 4.6 / DeepSeek V4 / GPT-5.5）：性能均衡，适合日常编码
 *   - 深度推理（Opus 4.8 thinking / GPT-5.5 thinking / DeepSeek V4 Pro）：适合分析、重构、架构决策
 *
 *   三者 API 成本差异数量级——路由决策直接决定单次运行的账单。
 */
export interface IModelRouter {
  /** 路由策略标识名 */
  readonly name: string;

  /**
   * 为给定任务节点选择最合适的模型。
   * @param node 任务节点（含 payload/reasoningEffort/tags/preferredStrategy）
   * @param agentType Agent 类型（code/review/fix/analysis/research）
   * @param defaultModel Agent 注册时的默认模型（fallback）
   * @returns 选中的模型标识符
   */
  route(node: TaskNode, agentType: string, defaultModel: string): Promise<string>;
}

// ══════════════════════════════════════════════
// IScheduler —— 调度器公开接口
// ══════════════════════════════════════════════

/**
 * IScheduler —— 调度器公开接口。
 * Scheduler 和 CompositeScheduler 均实现此接口，
 * CLI/EngineBridge/Bootstrap 通过此接口依赖调度器。
 */
export interface IScheduler {
  register(agentType: string, agent: Agent, model: string): void;
  executeAll(): Promise<ExecutionReport>;
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
  /** 模型路由（默认 FixedModelRouter——始终使用 Agent 注册模型） */
  modelRouter?: IModelRouter;
}
