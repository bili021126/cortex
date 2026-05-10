// ============================================================
// @cortex/shared — 任务域
// ============================================================

import type { AgentType, Tag } from "./agent.js";

// ─── TaskBoard ─────────────────────────────────────────────

export interface TaskNode {
  id: string;
  parentId?: string;
  type: string;
  tags: Tag[];
  needsMultiPerspective: boolean;
  status: "pending" | "claimed" | "running" | "done" | "failed";
  claimedBy: AgentType[]; // 已认领的 Agent 类型列表（multi-perspective 允许多个）
  payload: string; // MetaAgent 的任务描述
  results: NodeResult[]; // 每个 Agent 类型一个结果（multi-perspective 多个）
  createdAt: number;
  /** 推理深度。MetaAgent 规划时设定，Agent 执行时可用。默认 "high"。 */
  reasoningEffort?: "high" | "max";
}

export interface NodeResult {
  nodeId: string;
  agentType?: AgentType; // 错误节点可能无 Agent 匹配
  success: boolean;
  output?: string;
  error?: string;
}

// ─── 重规划 ────────────────────────────────────────────────

/** 影响范围：local 只换当前节点，subtree 连下游一起回收 */
export type ImpactScope = "local" | "subtree";

/** MetaAgent.requestReplan 的返回值 */
export interface ReplanResult {
  nodes: TaskNode[];
  impactScope: ImpactScope;
}

// ─── 调度层 ────────────────────────────────────────────────

export interface ExecutionReport {
  totalNodes: number;
  completed: number;
  failed: number;
  results: NodeResult[];
  durationMs: number;
}
