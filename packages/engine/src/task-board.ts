import type { AgentType, TaskNode, InvariantViolation, InvariantReporter } from "@cortex/shared";
import { AGENT_TAGS, PipelineEventType, PipelinePriority } from "@cortex/shared";
import type { PipelineObserver } from "./pipeline-observer.js";
import { isTestEnv } from "./test-env.js";

// InvariantViolation + InvariantReporter 已迁移至 @cortex/shared —— 从 shared import 即可
// 迁移原因（艾尔海森 P1）：TaskBoard 和 AgentPool 共用同一套 invariant 上报签名，
// 统一到 shared 中可避免类型漂移。

/**
 * TaskBoard —— 任务板
 *
 * @contract 模块边界契约（久岐忍 P1-5：模块边界缺少显式契约化定义 → 已闭合）
 *
 * @depends  @cortex/shared（AgentType, AGENT_TAGS, TaskNode, PipelineEventType）
 * @depends  pipeline-observer.ts（可选——通过 setObserver 注入，双通道 invariant 上报）
 * @dataflow 纯数据结构管理器：节点 Map → claim/release/complete 原子操作 → 状态转移
 *           无下游依赖——TaskBoard 是 Scheduler 的被动数据源，不主动调用外部模块
 *
 *   claim/release/complete 三方法构成 Scheduler 与 TaskBoard 之间的核心协议：
 *
 *   前置条件：
 *   - claim(): 节点存在且标签匹配，status=pending（普通）或非 done/failed（multi）
 *   - release(): status=claimed（普通）或非 done/failed 且 claimedBy 含 agentType（multi）
 *   - complete(): claimedBy 含 agentType，且 results 中同 agentType 不重复
 *
 *   后置条件：
 *   - claim() 成功：status 变为 claimed（普通）或 claimedBy 追加 agentType（multi）
 *   - release() 成功：status 回退 pending（普通），claimedBy 移除 agentType（multi）
 *   - complete() 后 status 为 done/failed（普通）或等齐全部 claimed 后 done（multi）
 *
 *   不变量：
 *   - results 中每个 agentType 必须存在于 claimedBy 中（对称性——TaskBoard.complete 检查）
 *   - done/failed 终态不可逆
 *
 * 原子 claim、标签匹配、needsMultiPerspective 多 Agent 并行认领与等齐。
 *
 * @fix D6 — invariant 上报单通道收敛：_observer 实例优先于 onInvariant 静态字段，
 *   消除重复 emit 和维护负担。
 */
export class TaskBoard {
  private nodes = new Map<string, TaskNode>();
  private _observer?: PipelineObserver;

  /**
   * invariant 违规上报后端。
   * 默认为 `null`（仅 console.error）。
   * 在 bootstrap 中注入 observer.emit 后，所有 invariant 违规会走 observer 管道。
   *
   * 优先级：实例 _observer > 静态 onInvariant > console.error
   */
  static onInvariant: InvariantReporter | null = null;

  /** 注入 PipelineObserver（与 onInvariant 互补的双通道模式） */
  setObserver(observer: PipelineObserver): void {
    this._observer = observer;
  }

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
      this._reportInvariant("TaskBoard.complete", msg, { nodeId, orphanTypes, claimedBy: node.claimedBy });
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
        this._reportInvariant("TaskBoard.removeSubtree", msg, { nodeId: id, status: n.status, originalParentId: nodeId });
      }
    }
    const root = this.nodes.get(nodeId);
    if (!root) return;
    if (root.status === "pending" || root.status === "claimed") {
      this.nodes.delete(nodeId);
    } else {
      const msg = `removeSubtree: 跳过终态根节点 ${nodeId} (${root.status})——将成为孤儿`;
      this._reportInvariant("TaskBoard.removeSubtree", msg, { nodeId, status: root.status });
    }
  }

  /**
   * 统一 invariant 上报通道。
   * 优先级：_observer > onInvariant > console.error
   * 单通道收敛，消除双路径重复 emit 风险。
   */
  private _reportInvariant(source: string, message: string, details?: unknown): void {
    if (this._observer) {
      this._observer.emit({
        type: PipelineEventType.TaskBoardInvariantViolation,
        priority: PipelinePriority.CRITICAL,
        payload: { source, detail: JSON.stringify({ message, ...(details as Record<string, unknown> ?? {}) }) },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    } else if (TaskBoard.onInvariant) {
      TaskBoard.onInvariant({ source, message, details });
    } else if (!isTestEnv()) {
      console.error(`[invariant] ${source}: ${message}`);
    }
  }
}
