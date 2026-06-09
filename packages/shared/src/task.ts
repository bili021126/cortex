// ============================================================
// @cortex/shared — 任务域
// ============================================================

import type { AgentType, Tag } from "./agent.js";

// ─── 上下文密度分级 ─────────────────────────────────────────

/**
 * 上下文密度级别——子任务间传递上下文时的压缩策略。
 *
 * light:  确认性产出，一句话摘要即可
 * medium: 有结构可压缩，保留关键字段裁冗余
 * heavy:  不可丢失，保留全貌宁压 token 不丢信息
 *
 * @since RLM 递归拆解（思考执行体系总纲 §六）
 */
export type DensityLevel = "light" | "medium" | "heavy";

/**
 * 密度压缩后的子任务产出。
 * 含 LLM 自标注的密度标签，下游子任务据此决定精读/扫读。
 */
export interface DensityAnnotated {
  /** 原始完整输出 */
  raw: string;
  /** LLM 自标注的密度级别 */
  density: DensityLevel;
  /** 压缩后的摘要（light=一句话，medium=关键字段，heavy=全貌） */
  compressed: string;
}

// ─── DAG 边语义 ────────────────────────────────────────────

/**
 * 依赖边类型。
 *
 * hard:    B 绝对等 A（现有行为，默认值）
 * soft:    B 和 A 并行启动，B 收敛时等 A 的结果
 * trigger: A 成功后触发 B，失败则不触发
 *
 * @since RLM 递归拆解（思考执行体系总纲 §三）
 */
export type EdgeType = "hard" | "soft" | "trigger";

// ─── RLM 子任务 ────────────────────────────────────────────

/**
 * RLM 子任务——由 decompose() 从宏观 TaskNode 拆解出的原子执行单元。
 * 不走 AgentPool 完整生命周期，直接调 agent.execute(subTask, model)。
 *
 * @since RLM 递归拆解（思考执行体系总纲 §四）
 */
export interface SubTask {
  /** 子任务唯一标识（decompose 时由 LLM 生成） */
  id: string;
  /** 子任务描述——比宏观节点更窄更硬，单文件/单维度/明确出口 */
  description: string;
  /** 此子任务依赖的其他子任务 ID 列表 */
  dependsOn: string[];
  /** LLM 自标注的上下文密度级别 */
  density: DensityLevel;
  /** decompose() 对此子任务原子性的信心 (0-1)，低于阈值则不拆 */
  confidence: number;
}

/**
 * decompose() 的返回结果。
 */
export interface DecomposeResult {
  /** 拆解出的子任务列表。空数组 = 不可拆/无需拆 */
  subTasks: SubTask[];
  /** LLM 对整体拆解方案的信心 (0-1)。< 0.6 时回退到直接执行 */
  confidence: number;
  /** 拆解理由——用于诊断日志 */
  rationale: string;
}

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
  /**
   * RLM 子任务标记。MetaAgent replan 生成的子任务设为 true，
   * Scheduler/AgentPool 据此放宽池子限制——子任务不占主配额。
   */
  isRlmSubtask?: boolean;
  /**
   * 依赖边类型。默认 "hard"（绝对等待）。
   * soft = 并行启动 + 收敛时等结果；trigger = 成功才触发。
   * @since RLM 递归拆解（思考执行体系总纲 §三）
   */
  edgeType?: EdgeType;
  /**
   * 上下文管理策略 ID——引用 ContextPolicy.id。
   * MetaAgent 规划时根据任务类型自动选择，Agent 执行时据此构建上下文。
   * 未设定时回退到默认策略（"single-step"）。
   * @since Cortex Core-2 — 上下文生命周期管理协议
   */
  contextPolicyId?: string;
  /**
   * ManifoldGate 流控槽位获取超时（ms），覆盖全局默认值。
   * 关键节点可设更长等待时间避免超时失败。
   * @since mHC 流约束 per-node override
   */
  acquireTimeoutMs?: number;
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
  /** 运行会话标识——每次 executeAll() 生成唯一 runId，用于记忆 sessionId 锚定 */
  sessionId?: string;
}
