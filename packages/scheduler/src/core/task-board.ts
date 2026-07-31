import { PipelineEventType, PipelinePriority, getAgentTags, type AgentType, type IPipelineObserver, type InvariantReporter, type InvariantViolation, type TaskNode, type ITaskBoard, type ISchedulerAgentPool } from "@cortex/shared";
import { CLAIM_LEASE_MS } from "@cortex/config";

/**
 * ITaskBoard —— TaskBoard 抽象接口（契约已上迁至 @cortex/shared）。
 *
 * 本处以兼容方式 re-export，保持旧消费方（@cortex/scheduler）可用。
 * 新消费方应从 @cortex/shared 导入。
 */
export type { ITaskBoard };

/**
 * TaskBoard —— 任务板
 *
 * @contract 模块边界契约
 *
 * @depends  @cortex/shared（AgentType, AGENT_TAGS, TaskNode, PipelineEventType）
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
export class TaskBoard implements ITaskBoard {
  private nodes = new Map<string, TaskNode>();
  private _observer?: IPipelineObserver;
  /** AgentPool 引用——claim lease 回收前交叉验证原 agent 是否仍活跃 */
  private _pool?: ISchedulerAgentPool;

  /**
   * invariant 违规上报后端。
   * 默认为 `null`（仅 console.error）。
   * 在 bootstrap 中注入 observer.emit 后，所有 invariant 违规会走 observer 管道。
   *
   * 优先级：实例 _observer > 静态 onInvariant > console.error
   */
  static onInvariant: InvariantReporter | null = null;

  /** 注入 PipelineObserver（与 onInvariant 互补的双通道模式） */
  setObserver(observer: IPipelineObserver): void {
    this._observer = observer;
  }

  /** 注入 AgentPool——lease 回收前交叉验证原 agent 是否仍活跃 */
  setPool(pool: ISchedulerAgentPool): void {
    this._pool = pool;
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
    const agentTags = getAgentTags()[agentType] as readonly string[];
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
    // R5-T1 fix: claimed 节点超时自动回收为 pending（lease 120s）
    // P2 fix: 回收前验证原 agent 是否仍活跃——若实例仍存在则续期而非回收，
    //   防止超长执行（> CLAIM_LEASE_MS）的 agent 被回收导致双重执行
    if (node.status === "claimed" && node.claimedAt) {
      if (Date.now() - node.claimedAt > CLAIM_LEASE_MS) {
        const claimer = node.claimedBy[0];
        const claimerStillActive = claimer !== undefined
          ? this._pool?.getStatus(claimer) !== undefined
          : false;
        if (claimerStillActive) {
          // 原 agent 仍活跃 → 续期，不回收（等 agent 完成路径释放）
          node.claimedAt = Date.now();
          return null;
        }
        node.status = "pending";
        node.claimedBy = [];
        node.claimedAt = undefined;
      } else {
        return null;
      }
    }
    if (node.status !== "pending") return null;
    node.status = "claimed";
    node.claimedBy = [agentType];
    node.claimedAt = Date.now();
    return node;
  }

  /**
   * 续期认领——延长 lease。
   * 用于长执行场景：agent 仍在活跃执行但接近 CLAIM_LEASE_MS 时调用，
   * 防止 lease 过期被回收导致同一节点被二次执行。
   *
   * @param nodeId 节点 ID
   * @param agentType 认领者
   * @returns true 表示续期成功（节点当前被该 agent 认领）
   */
  renewClaim(nodeId: string, agentType: AgentType): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    // 仅普通 claimed 节点且认领者匹配才可续期
    if (node.needsMultiPerspective) return false;
    if (node.status !== "claimed") return false;
    if (!node.claimedBy.includes(agentType)) return false;
    node.claimedAt = Date.now();
    return true;
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
      } else if (node.claimedBy.length > 0) {
        // 多视角自愈：移除失败视角后，剩余认领者已全部产出 → 等齐置 done。
        // 否则节点会卡 running 直到 complete() 重入——但失败视角已 release，
        // 需在此补齐等齐判定（spawn 失败自愈场景）。
        const claimed = new Set(node.claimedBy);
        const done = new Set(node.results.map((r) => r.agentType));
        if (claimed.size === done.size && [...claimed].every((t) => done.has(t))) {
          node.status = "done";
          node.claimedBy = []; // 终态清理
        }
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
    const agentTags = getAgentTags()[agentType] as readonly string[];
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
    if (!node?.claimedBy.includes(agentType)) return;

    if (!node.needsMultiPerspective) {
      // 普通节点：去重在前
      if (node.results.some((r) => r.agentType === agentType)) return;

      node.results.push({
        nodeId,
        agentType,
        success,
        output,
        error,
      });

      node.status = success ? "done" : "failed";
      node.claimedBy = []; // 终态清理
      return;
    }

    // ── Multi-perspective 节点：去重在先 ──
    if (node.results.some((r) => r.agentType === agentType)) return;

    node.results.push({
      nodeId,
      agentType,
      success,
      output,
      error,
    });

    // H6 fix: 多视角节点 complete() 的不变量检查只在 claimedBy 完全清理前执行。
    // 原逻辑在等齐 done 后清空 claimedBy，但后续视角调用 complete() 时 claimedBy 为空，
    // 导致合法结果被误判为 orphan 删除。修改：仅在 claimedBy 非空时检查不变量。
    if (node.claimedBy.length > 0 && !node.results.every((r) => r.agentType && node.claimedBy.includes(r.agentType))) {
      const orphanTypes = node.results.filter((r) => r.agentType && !node.claimedBy.includes(r.agentType)).map((r) => r.agentType);
      const msg = `results 包含未在 claimedBy 中的 agentType: ${orphanTypes} — claimedBy=[${node.claimedBy}]`;
      this._reportInvariant("TaskBoard.complete", msg, { nodeId, orphanTypes, claimedBy: node.claimedBy });
      // 阻断：移除孤儿结果（splice mutation，兼容 Object.freeze/Proxy）
      const valid = node.results.filter((r) => r.agentType && node.claimedBy.includes(r.agentType));
      node.results.length = 0;
      node.results.push(...valid);
    }

    // 用 claimedBy 而非 _expectedAgentTypes：只有实际认领的 Agent 才参与等齐判断
    const claimed = new Set(node.claimedBy);
    const done = new Set(node.results.map((r) => r.agentType));
    if (claimed.size === done.size && [...claimed].every((t) => done.has(t))) {
      node.status = "done";
      node.claimedBy = []; // 终态清理
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
    node.claimedBy = []; // 终态清理
    return true;
  }

  /** 多视角节点是否已等齐全部认领 Agent */
  allPerspectivesComplete(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node?.needsMultiPerspective) return false;
    // 终态 done：complete() 等齐后已清空 claimedBy 做终态清理，
    // 此处直接返回 true——多视角节点能到 done 必然是等齐所致。
    if (node.status === "done") return true;
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

  /** 清空所有节点（新 plan 执行前调用，防止旧任务残留） */
  clear(): void {
    this.nodes.clear();
  }

  /**
   * 移除单个节点，emit NodeRemoved 事件。
   */
  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    if (this._observer) {
      this._observer.emit({
        type: PipelineEventType.NodeRemoved,
        priority: PipelinePriority.NORMAL,
        payload: { nodeId },
        timestamp: Date.now(),
        notificationType: "FYI",
      });
    }
  }

  /**
   * 移除子树（节点及其所有子孙）。
   * 使用 BFS 遍历收集后代节点后统一删除。
   */
  removeSubtree(nodeId: string): void {
    const toRemove: string[] = [nodeId];
    const queue = [nodeId];
    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId) break;
      for (const [id, node] of this.nodes) {
        if (node.parentId === currentId) {
          toRemove.push(id);
          queue.push(id);
        }
      }
    }

    const statusCounts = new Map<string, number>();
    for (const id of toRemove) {
      const node = this.nodes.get(id);
      if (node) {
        statusCounts.set(node.status, (statusCounts.get(node.status) ?? 0) + 1);
      }
    }

    for (const id of toRemove) {
      this.nodes.delete(id);
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.NodeRemoved,
          priority: PipelinePriority.NORMAL,
          payload: { nodeId: id },
          timestamp: Date.now(),
          notificationType: "FYI",
        });
      }
    }

    const statusSummary = [...statusCounts.entries()]
      .map(([s, c]) => `${s}:${c}`)
      .join(", ");
    const msg = `removeSubtree(root=${nodeId}): removed ${toRemove.length} nodes (${statusSummary})`;
    this._reportInvariant("TaskBoard.removeSubtree", msg, {
      rootNodeId: nodeId,
      removedCount: toRemove.length,
      statusCounts: Object.fromEntries(statusCounts),
    });
  }

  /**
   * 取消任务节点。
   */
  cancel(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    if (node.status === "pending" || node.status === "claimed") {
      this.nodes.delete(nodeId);
      if (this._observer) {
        this._observer.emit({
          type: PipelineEventType.NodeRemoved,
          priority: PipelinePriority.NORMAL,
          payload: { nodeId },
          timestamp: Date.now(),
          notificationType: "FYI",
        });
      }
      this._reportInvariant("TaskBoard.cancel", `节点 ${nodeId} 被取消移除，原状态 ${node.status}`, {
        nodeId,
        originalStatus: node.status,
      });
      return true;
    }

    this._reportInvariant("TaskBoard.cancel", `节点 ${nodeId} 状态 ${node.status} 不可取消`, {
      nodeId,
      status: node.status,
    });
    return false;
  }

  /**
   * 上报 invariant 违规。
   * 优先级：实例 _observer > 静态 onInvariant > console.error
   */
  private _reportInvariant(
    source: string,
    message: string,
    details?: unknown,
  ): void {
    const violation: InvariantViolation = { source, message, details };

    if (this._observer) {
      this._observer.emit({
        type: PipelineEventType.TaskBoardInvariantViolation,
        priority: PipelinePriority.CRITICAL,
        payload: { source, detail: message },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
      return;
    }

    if (TaskBoard.onInvariant) {
      TaskBoard.onInvariant(violation);
      return;
    }

    console.error(`[TaskBoard] ${source}: ${message}`, details ?? "");
    }
  }
