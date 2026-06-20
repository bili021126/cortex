// ============================================================
// @cortex/shared — Agent 能力协议
//
// MemoryAware / Executable / Agent 接口 —— 所有 Agent 的契约。
// Scheduler、AgentPool、MetaAgent 均依赖这些协议进行调度与编排。
// ============================================================

import type { AgentType, AgentStatus } from "./agent-enums.js";
import type { MemoryQuery } from "./memory.js";
import type { TaskNode, NodeResult } from "./task.js";

/** Agent 池注册配置 */
export interface AgentConfig {
  type: AgentType;
  maxInstances?: number;
}

/**
 * MemoryAware —— 记忆感知能力。
 *
 * Agent 若实现了此接口，表明该 Agent 具备执行前检索记忆的能力。
 */
export interface MemoryAware {
  /** 记忆检索策略——返回 MemoryQuery 供 executeWithMemoryPipeline 调用 */
  getMemoryQuery?(node: TaskNode): MemoryQuery;
}

/**
 * Executable —— 可执行能力。
 *
 * Agent 若实现了此接口，表明该 Agent 可被 Scheduler 调度。
 */
export interface Executable {
  /**
   * 执行任务节点。
   *
   * @param node 待执行的任务节点
   * @param model 可选 LLM 模型名（Scheduler 按 AgentType 分配模型，传入执行链）
   * @returns 节点执行结果（成功/失败、输出内容、错误信息）
   */
  execute(node: TaskNode, model?: string): Promise<NodeResult>;
}

/**
 * Agent —— Agent 的统一接口。
 * 所有 Agent 必须实现此接口。
 */
export interface Agent extends MemoryAware, Executable {
  readonly type: AgentType;
  /** Agent 当前生命周期状态 */
  readonly status: AgentStatus;
  wakeup(): Promise<void>;
  shutdown(): Promise<void>;
  /** 注入 AgentPool 引用 */
  setPool?(pool: unknown, instanceId: string): void;
}

// ═══════════════════════════════════════════
// Agent 自声明系统（v2.7 — Kimi Agent Swarm 对齐）
// ═══════════════════════════════════════════

/**
 * Agent 自声明——描述一个 Agent 的完整能力画像。
 *
 * 每个 Agent 通过导出静态 capability 实现"自声明"：
 * 不需手动注册，系统启动时自动收集所有声明，MetaAgent 据此自组装。
 *
 * @since v2.7 — Agent 自声明与自组装
 */
export interface AgentCapability {
  /** Agent 类型标识 */
  type: AgentType;
  /** 人类可读角色名（格式："短名 — 头衔"） */
  role: string;
  /** emoji 图标 */
  emoji: string;

  /** 认领标签——MetaAgent 按标签匹配任务 */
  tags: string[];
  /** 产出的事件类型 */
  produces: string[];

  /** 需要的工具权限列表 */
  toolPermissions: string[];
  /** 记忆检索策略标识 */
  memoryQueryStrategy: string;

  /** 最大实例数 */
  maxInstances: number;
  /** 使用的模型 key */
  modelKey: string;

  /** 适用场景——自然语言描述（供 MetaAgent 决策） */
  applicableScenarios: string[];
  /** 输出格式——"code" | "report" | "decision" | "structured" */
  outputFormat: string;
  /** 协作模式——"solo" | "reviewer" | "subordinate" */
  collaborationMode: "solo" | "reviewer" | "subordinate";
}
