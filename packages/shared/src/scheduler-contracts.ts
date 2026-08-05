// ============================================================
// @cortex/shared/scheduler-contracts —— Scheduler 契约层
//
// 【定位】把 Scheduler 对外暴露的接口从实现包提升到 shared，
// 让 TUI / CLI / WebUI 等消费方不必反向依赖 @cortex/scheduler。
//
// 【单一起源】实际实现仍在 @cortex/scheduler；scheduler 侧的
// task-board.ts / agent-pool.ts 会 `import type` 并 re-export，
// 保证消费方可以从任一处导入相同的类型。
// ============================================================

import type { AgentType, AgentStatus } from "./agent-enums.js";
import type { TaskNode } from "./task.js";
import type { AgentConfig, Agent } from "./agent-protocols.js";
import type { IPipelineObserver } from "./infra.js";
import type { ExecutionReport } from "./task.js";

/**
 * ITaskBoard —— TaskBoard 抽象接口。
 * 解耦点：Scheduler 与消费方（TUI/WebUI）不再依赖 TaskBoard 具体类，
 * 而是通过此接口交互。
 */
export interface ITaskBoard {
  addNode(node: TaskNode): void;
  claim(nodeId: string, agentType: AgentType): TaskNode | null;
  release(nodeId: string, agentType: AgentType): boolean;
  complete(nodeId: string, agentType: AgentType, success: boolean, output?: string, error?: string): void;
  failNode(nodeId: string): boolean;
  getNode(nodeId: string): TaskNode | undefined;
  getAllNodes(): TaskNode[];
  getPendingNodes(): TaskNode[];
  removeNode(nodeId: string): void;
  removeSubtree(nodeId: string): void;
  /** R12-B3 替代：claim 撞 lease 的重试计数（上限内跳过等回收，超限才 failNode） */
  getClaimRetries(nodeId: string): number;
  /** R13-B3：首次撞 lease 的时间（时间基判定） */
  getClaimFirstAt(nodeId: string): number;
  incrementClaimRetry(nodeId: string): number;
  resetClaimRetries(nodeId: string): void;
  /** R13-B4：注入 AgentPool 引用（lease 续期判定交叉验证原 agent 是否仍活跃） */
  setPool(pool: ISchedulerAgentPool): void;
  /** 清空所有节点（新 plan 执行前调用，防止旧任务残留） */
  clear(): void;
}

/**
 * ISchedulerAgentPool —— Scheduler 依赖的 AgentPool 最小契约。
 * 提取此接口使 Scheduler 不依赖具体 AgentPool 实现，
 * 允许 CLI 侧 MiniAgentPool 在轻量模式下替代完整 AgentPool。
 */
export interface ISchedulerAgentPool {
  spawn(agentType: AgentType, instanceId: string): boolean;
  /** RLM 子任务——不占主配额 */
  spawnSubtask(agentType: AgentType, instanceId: string): boolean;
  getStatus(instanceId: string): AgentStatus | undefined;
  setStatus(instanceId: string, status: AgentStatus): boolean;
  /** R12-B4：检查某类型是否有 Awake 状态的实例（lease 续期判定用 agentType 而非 instanceId——键空间正确） */
  hasAwake(agentType: AgentType): boolean;
  destroy(agentType: AgentType, instanceId: string): void;
  /** 记录 agent 心跳——更新最后活跃时间戳 */
  heartbeat(agentId: string): void;
  /** 探测 agent 是否存活——仍在 pool 活跃列表中返回 true */
  ping(agentId: string): Promise<boolean>;
  /** 池统计——用于遥测 */
  getPoolStats(): { total: number; idle: number; busy: number; idleRate: number };
}

/**
 * IAgentPool —— AgentPool 完整管理接口。
 * 扩展 ISchedulerAgentPool（Scheduler 最小依赖），补全管理端方法。
 */
export interface IAgentPool extends ISchedulerAgentPool {
  register(config: AgentConfig): void;
  /** 动态调整 AgentType 最大并发数（热扩容/缩容） */
  setMaxInstances(agentType: AgentType, newMax: number): void;
  setObserver(observer: IPipelineObserver): void;
  getStatuses(agentType: AgentType): AgentStatus[];
  hasAwake(agentType: AgentType): boolean;
  canSpawn(agentType: AgentType): boolean;
  count(agentType: AgentType): number;
}

// ══════════════════════════════════════════════
// IScheduler —— 调度器最小契约
// ══════════════════════════════════════════════

/**
 * IScheduler —— 调度器公开接口（最小契约）。
 * CLI/EngineBridge/TUI 通过此接口依赖调度器，
 * 不依赖 @cortex/scheduler 具体实现。
 */
export interface IScheduler {
  register(agentType: string, agent: Agent, model: string): void;
  executeAll(): Promise<ExecutionReport>;
}

// ══════════════════════════════════════════════
// IStrategistAgent —— Strategist 最小契约
// ══════════════════════════════════════════════

/**
 * IStrategistAgent —— Strategist Agent 最小契约。
 * CLI agent inspect 命令仅需读取 status，
 * 不依赖 @cortex/engine 具体实现。
 */
export interface IStrategistAgent {
  readonly status: AgentStatus;
}
