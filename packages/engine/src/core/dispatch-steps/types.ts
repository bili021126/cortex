import { type Agent, type IPipelineObserver, type NodeResult, type TaskNode } from "@cortex/shared";
import type { ITaskBoard } from "../task-board.js";
import type { ISchedulerAgentPool } from "../agent-pool.js";
import type { LlmCallable } from "../rlm-decompose.js";

/**
 * DispatchCtx —— 调度分发管道的共享上下文。
 *
 * 设计原则（沿用 PipelineCtx 模式）：
 * - 只读字段（agents/models/board/pool/observer）Step 不应修改
 * - 可变状态（agentType/agent/instanceId/result 等）在管道推进中逐步填充
 * - Step 通过 run(ctx) → 返回新 ctx 传递状态
 */
export interface DispatchCtx {
  // ── 只读配置（由 Scheduler 注入） ──
  readonly agents: Map<string, Agent>;
  readonly models: Map<string, string>;
  readonly board: ITaskBoard;
  readonly pool: ISchedulerAgentPool;
  readonly observer: IPipelineObserver;
  readonly isTestEnv: boolean;
  /** RLM 拆解用的 LLM 调用入口。由 Scheduler 从 MetaAgent/MemoryStore 注入 */
  readonly llmChat?: LlmCallable;

  // ── 分发起点 ──
  node: TaskNode;

  // ── Step 间流转状态 ──
  /** ClaimStep 填充 */
  agentType?: string;
  agent?: Agent;
  /** SpawnStep 填充 */
  instanceId?: string;
  /** 执行使用的模型名 */
  model?: string;
  /** ExecuteStep 填充 */
  result?: NodeResult;
  /** BoundaryGuardStep 填充——边界违规信息 */
  boundaryViolation?: {
    agentType: string;
    files: string[];
  };
}

/**
 * IDispatchStep —— 调度分发管道中的一个可插拔步骤。
 * 与 IStep 模式一致：单一步骤只做一件事，可独立测试，可自由组合。
 */
export interface IDispatchStep {
  /** 步骤名——用于调试和日志 */
  readonly name: string;

  /** 执行此步骤，返回更新后的上下文 */
  run(ctx: DispatchCtx): Promise<DispatchCtx>;
}
