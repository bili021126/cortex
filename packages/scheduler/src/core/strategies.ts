/**
 * strategies —— 调度四抽象之实现（由 scheduling-implementations.ts 拆分，2026-06-20 SCH-1）。
 *
 * 拆分自原 1457 行单文件：strategies / drivers / execution-models / model-routers。
 */

import { AgentStatus, type Agent, type TaskNode } from "@cortex/shared";
import type { IScheduleStrategy } from "./scheduling-types.js";
import { findMatchingAgent, findAllMatchingAgents } from "./agent-matcher.js";

export class TagMatchingStrategy implements IScheduleStrategy {
  readonly name = "tag-matching";

  findMatchingAgent(node: TaskNode, agents: Map<string, Agent>): string | null {
    return findMatchingAgent(agents, node);
  }

  findAllMatchingAgents(node: TaskNode, agents: Map<string, Agent>): string[] {
    return findAllMatchingAgents(agents, node);
  }
}

/**
 * RoundRobinStrategy —— 轮转调度策略。
 *
 * 所有可用的 Agent 按注册顺序轮转分配节点，忽略标签匹配。
 * 适合负载均衡场景——所有 Agent 均匀分担工作量。
 *
 * 局限：node.type 与 AgentType 不匹配时，Agent 可能无法处理。
 *       建议仅在同构 Agent 池（如多个 CodeAgent）中使用。
 */
export class RoundRobinStrategy implements IScheduleStrategy {
  readonly name = "round-robin";
  private _rrIndex = 0;

  private _availableAgents(agents: Map<string, Agent>): string[] {
    return [...agents.entries()]
      .filter(([, a]) => a.status === AgentStatus.Awake || a.status === AgentStatus.Active)
      .map(([type]) => type);
  }

  findMatchingAgent(node: TaskNode, agents: Map<string, Agent>): string | null {
    // 优先精确匹配
    const exact = findMatchingAgent(agents, node);
    if (exact) return exact;

    // 回退：轮转
    const available = this._availableAgents(agents);
    if (available.length === 0) return null;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const chosen = available[this._rrIndex % available.length]!;
    this._rrIndex++;
    return chosen;
  }

  findAllMatchingAgents(node: TaskNode, agents: Map<string, Agent>): string[] {
    const tagMatch = findAllMatchingAgents(agents, node);
    if (tagMatch.length > 0) return tagMatch;
    return this._availableAgents(agents);
  }
}

/**
 * PriorityFirstStrategy —— 优先级优先策略。
 *
 * 对标签匹配策略的增强：匹配分数相同时，优先选择当前空闲（无 claimed 节点）的 Agent。
 * 适合混合负载场景——避免热点 Agent 过载。
 *
 * 其余行为与 TagMatchingStrategy 一致。
 */
export class PriorityFirstStrategy implements IScheduleStrategy {
  readonly name = "priority-first";

  findMatchingAgent(node: TaskNode, agents: Map<string, Agent>): string | null {
    return findMatchingAgent(agents, node);
  }

  findAllMatchingAgents(node: TaskNode, agents: Map<string, Agent>): string[] {
    // 扩大匹配范围：包含所有可用 Agent 而不只是标签匹配
    const tagMatch = findAllMatchingAgents(agents, node);
    const idle = [...agents.keys()].filter((t) => {
      if (tagMatch.includes(t)) return true;
      const a = agents.get(t);
      return a?.status === AgentStatus.Awake;
    });
    return idle.length > 0 ? idle : tagMatch;
  }
}

// ══════════════════════════════════════════════
// ILoopDriver 实现
// ══════════════════════════════════════════════

/**
 * TopologicalLayeredDriver —— 默认拓扑分层驱动。
 *
 * 行为与现有 Scheduler.executeAll() 完全一致：
 * 1. while 循环：只要还有 pending 节点就继续
 * 2. 拓扑排序 → 分层
 * 3. 逐层并行执行（Promise.allSettled）
 * 4. 处理重规划队列（replanManager）
 * 5. 全局超时保护
 */
