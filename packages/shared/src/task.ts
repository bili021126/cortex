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
  /**
   * 偏好循环策略。MetaAgent 规划时可根据任务复杂度设定。
   * Agent 在 execute() 时据此选择对应策略；未设定时回退到默认 ReAct。
   * @since Core-2
   */
  preferredStrategy?: "react" | "direct" | "decompose" | "jury";
}

/**
 * 节点执行结果——所有 Agent.execute() 的返回值。
 *
 * @contract 久岐忍 P2-8：端点返回字段不可膨胀 → 已闭合
 *   此类型是 Engine → Consumer 的契约边界。任何新增字段必须：
 *   1. 在对应 PR 中显式声明
 *   2. 更新本文档的字段列表
 *   3. 标注 @since 版本
 *   禁止在返回对象中附加契约未声明的字段——隐式膨胀字段一旦被下游依赖，
 *   下个版本移除时即为无声的破坏性变更。
 */
export interface NodeResult {
  nodeId: string;
  agentType?: AgentType; // 错误节点可能无 Agent 匹配
  success: boolean;
  output?: string;
  error?: string;
}

// ─── 重规划 ────────────────────────────────────────────────

/**
 * 影响范围：local 只换当前节点，subtree 连下游一起回收。
 *
 * @usedBy MetaAgent.requestReplan — MetaAgent 根据此值标记影响范围，
 *   Scheduler 通过 ReplanResult.impactScope 间接消费：
 *   "local"   → 仅替换当前失败节点
 *   "subtree" → 递归移除所有下游子节点后重新规划
 */
export type ImpactScope = "local" | "subtree";

/** MetaAgent.requestReplan 的返回值 */
export interface ReplanResult {
  nodes: TaskNode[];
  impactScope: ImpactScope;
  /** 当 nodes 为空时，说明无替代方案的原因。
   *   - "no_alternative": LLM 判定无法重规划
   *   - "max_replan_reached": 已达到最大重规划次数
   *   - undefined: 尚未调用或正常返回 */
  error?: string;
}

// ─── 调度层 ────────────────────────────────────────────────

export interface ExecutionReport {
  totalNodes: number;
  completed: number;
  failed: number;
  results: NodeResult[];
  durationMs: number;
}
