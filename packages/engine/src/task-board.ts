import type { AgentType, TaskNode } from "@cortex/shared";
import { AGENT_TAGS } from "@cortex/shared";

/** invariant 违规上报回调签名。默认 console.error，外部可注入 observer.emit。 */
export interface InvariantViolation {
  source: string;        // 违规来源，如 "TaskBoard.complete"
  message: string;       // 人类可读描述
  details?: unknown;     // 附加上下文（claimedBy vs results 等）
}

export type InvariantReporter = (violation: InvariantViolation) => void;

/**
 * TaskBoard —— 任务板
 * 原子 claim、标签匹配、needsMultiPerspective 多 Agent 并行认领与等齐。
 */
export class TaskBoard {
  private nodes = new Map<string, TaskNode>();

  /**
   * invariant 违规上报后端。
   * 默认为 `null`（仅 console.error）。
   * 在 bootstrap 中注入 observer.emit 后，所有 invariant 违规会走 observer 管道。
   */
  static onInvariant: InvariantReporter | null = null;

  addNode(node: TaskNode): void {
    this.nodes.set(node.id, node);
  }

  /**
   * 原子认领。
   *
   * **并发安全**：此方法是同步的（无 await），在 Node.js 单线程事件循环中
   * 天然原子。若未来引入异步检查（如标签验证），必须加互斥锁或改为状态机。
   *
   * 普通节点：仅 pending 可认领，已认领拒。
   * needsMultiPerspective：不同 Agent 类型可并行认领，同类型不可重复。
   */
  claim(nodeId: string, agentType: AgentType): TaskNode | null {
    const node = this.nodes.get(nodeId);
    if (!node) return null;

    // 标签匹配
    const agentTags = AGENT_TAGS[agentType] as readonly string[];
    if (!node.tags.some((t) => agentTags.includes(t))) return null;

    if (node.needsMultiPerspective) {
      // 同类型不可重复认领
      if (node.claimedBy.includes(agentType)) return null;
      // 已终态的不可认领
      if (node.status === "done" || node.status === "failed") return null;
      node.claimedBy.push(agentType);
      if (node.status === "pending") node.status = "running";
      return node;
    }

    // 普通节点：仅 pending 可认领，单 Agent
    if (node.status !== "pending") return null;
    node.status = "claimed";
    node.claimedBy = [agentType];
    return node;
  }

  /**
   * 释放认领。仅 claimed 态可回退到 pending。
   * running/done/failed 态拒绝释放——已开始执行的不可撤销。
   * 仅认领者本人可释放。
   *
   * multi-perspective：running 态允许释放单个 agentType（其他 Agent 继续执行），
   * 仅 done/failed 终态拒绝。防止 spawn 失败后该类型残留在 claimedBy 中导致死锁。
   */
  release(nodeId: string, agentType: AgentType): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    if (node.needsMultiPerspective) {
      const idx = node.claimedBy.indexOf(agentType);
      if (idx === -1) return false;
      // done/failed 终态不可释放；running 允许——移除失败参与方，其他 Agent 继续
      if (node.status === "done" || node.status === "failed") return false;
      node.claimedBy.splice(idx, 1);
      if (node.claimedBy.length === 0 && node.status !== "pending") {
        node.status = "pending";
      }
      return true;
    }

    // 普通节点：仅 claimed 态且认领者匹配才可释放
    if (node.status !== "claimed") return false;
    if (!node.claimedBy.includes(agentType)) return false;
    node.status = "pending";
    node.claimedBy = [];
    return true;
  }

  /**
   * 查找该 Agent 类型当前可认领的全部节点。
   * 普通节点只看 pending；multi-perspective 节点包含 running 中但该类型未认领的。
   */
  findPending(agentType: AgentType): TaskNode[] {
    const agentTags = AGENT_TAGS[agentType] as readonly string[];
    return Array.from(this.nodes.values()).filter((n) => {
      if (!n.tags.some((t) => agentTags.includes(t))) return false;
      if (n.needsMultiPerspective) {
        return !n.claimedBy.includes(agentType) &&
               n.status !== "done" &&
               n.status !== "failed";
      }
      return n.status === "pending";
    });
  }

  /**
   * Agent 产出结果。
   * needsMultiPerspective 节点：等所有匹配 Agent 类型全部产出后自动置为 done。
   * 普通节点：直接置 done/failed。
   */
  complete(
    nodeId: string,
    agentType: AgentType,
    success: boolean,
    output?: string,
    error?: string,
  ): void {
    const node = this.nodes.get(nodeId);
    if (!node || !node.claimedBy.includes(agentType)) return;

    // 去重：同 agentType 已在 results 中则跳过，防并发/重试导致的重复落盘
    if (node.results.some((r) => r.agentType === agentType)) return;

    node.results.push({
      nodeId,
      agentType,
      success,
      output,
      error,
    });

    // ── invariant：results 中每个 agentType 必须存在于 claimedBy 中 (对称性保障)
    if (!node.results.every((r) => r.agentType && node.claimedBy.includes(r.agentType))) {
      const orphanTypes = node.results.filter((r) => r.agentType && !node.claimedBy.includes(r.agentType)).map((r) => r.agentType);
      const msg = `results 包含未在 claimedBy 中的 agentType: ${orphanTypes} — claimedBy=[${node.claimedBy}]`;
      if (TaskBoard.onInvariant) {
        TaskBoard.onInvariant({ source: "TaskBoard.complete", message: msg, details: { nodeId, orphanTypes, claimedBy: node.claimedBy } });
      } else {
        console.error(`[invariant] TaskBoard.complete: ${msg}`);
      }
    }

    if (node.needsMultiPerspective) {
      // 用 claimedBy 而非 _expectedAgentTypes：只有实际认领的 Agent 才参与等齐判断
      const claimed = new Set(node.claimedBy);
      const done = new Set(node.results.map((r) => r.agentType));
      if (claimed.size === done.size && [...claimed].every((t) => done.has(t))) {
        node.status = "done";
      }
    } else {
      node.status = success ? "done" : "failed";
    }
  }

  /**
   * 强制标记节点为失败（无需认领，无需 agentType）。
   * 用于无匹配 Agent、无注册 Runner、状态不符等调度前错误路径。
   */
  failNode(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    if (node.status === "done" || node.status === "failed") return false;
    node.status = "failed";
    return true;
  }

  /** 多视角节点是否已等齐全部认领 Agent */
  allPerspectivesComplete(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node || !node.needsMultiPerspective) return false;
    const claimed = new Set(node.claimedBy);
    const done = new Set(node.results.map((r) => r.agentType));
    return claimed.size === done.size && [...claimed].every((t) => done.has(t));
  }

  getNode(nodeId: string): TaskNode | undefined {
    return this.nodes.get(nodeId);
  }

  /** 获取全部节点 */
  getAllNodes(): TaskNode[] {
    return Array.from(this.nodes.values());
  }

  /** 获取全部 pending/claimed 节点（供 executeAll 动态消费） */
  getPendingNodes(): TaskNode[] {
    return Array.from(this.nodes.values()).filter(
      (n) => n.status === "pending" || n.status === "claimed",
    );
  }

  /** 移除单个节点 */
  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
  }

  /** 获取某节点的所有后代（BFS） */
  getDescendants(nodeId: string): string[] {
    const result: string[] = [];
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const [id, n] of this.nodes) {
        if (n.parentId === current && !result.includes(id)) {
          result.push(id);
          queue.push(id);
        }
      }
    }
    return result;
  }

  /**
   * 移除节点及其整个下游子树。
   * 仅移除 pending/claimed 状态的节点。done/failed 节点不可逆，保留但记录警告。
   */
  removeSubtree(nodeId: string): void {
    const descendants = this.getDescendants(nodeId);
    // 先删后代再删自身
    for (const id of descendants) {
      const n = this.nodes.get(id);
      if (!n) continue;
      if (n.status === "pending" || n.status === "claimed") {
        this.nodes.delete(id);
      } else {
        // 终态节点无法安全删除（可能仍有外部引用），标记为孤儿并上报
        n.parentId = undefined; // 断开悬空引用
        const msg = `removeSubtree: 终态节点 ${id} (${n.status}) 已解除父节点引用——成为孤儿`;
        if (TaskBoard.onInvariant) {
          TaskBoard.onInvariant({ source: "TaskBoard.removeSubtree", message: msg, details: { nodeId: id, status: n.status, originalParentId: nodeId } });
        }
        console.warn(`[TaskBoard] ${msg}`);
      }
    }
    const root = this.nodes.get(nodeId);
    if (!root) return;
    if (root.status === "pending" || root.status === "claimed") {
      this.nodes.delete(nodeId);
    } else {
      const msg = `removeSubtree: 跳过终态根节点 ${nodeId} (${root.status})——将成为孤儿`;
      if (TaskBoard.onInvariant) {
        TaskBoard.onInvariant({ source: "TaskBoard.removeSubtree", message: msg, details: { nodeId, status: root.status } });
      }
      console.warn(`[TaskBoard] ${msg}`);
    }
  }
}
