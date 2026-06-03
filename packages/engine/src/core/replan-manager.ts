import type { TaskNode, NodeResult } from "@cortex/shared";
import { PipelinePriority, PipelineEventType } from "@cortex/shared";
import type { ITaskBoard } from "./task-board.js";
import type { IPipelineObserver } from "@cortex/shared";
import type { MetaAgent } from "./meta-agent.js";
import type { EngineConfig } from "@cortex/config";

/** 重规划入队项 */
export interface ReplanItem {
  node: TaskNode;
  reason: string;
  count: number; // 该节点已重规划次数
}

/**
 * ReplanManager —— 重规划管理器。
 *
 * 职责：
 * - 管理重规划队列（入队、消费、配额控制）
 * - 跟踪 replanMap、replanCount 等中间状态
 * - 执行结束后解析重规划链，修正 original node 的 result
 *
 * 生命周期：与 Scheduler 1:1 绑定。每个 executeAll() 调用 reset() 清零状态。
 */
export class ReplanManager {
  private replanCount = new Map<string, number>();
  private replanQueue: ReplanItem[] = [];
  private totalReplans = 0;
  private replanMap = new Map<string, string[]>(); // originalId → replan-generated new ids

  constructor(
    private readonly board: ITaskBoard,
    private readonly observer: IPipelineObserver,
    private readonly metaAgent: MetaAgent | undefined,
    private readonly config: Required<EngineConfig>,
  ) {}

  /** 是否有待处理的重规划任务 */
  get hasPending(): boolean {
    return this.replanQueue.length > 0;
  }

  /**
   * 将失败节点入队（如果未超过 per-node 上限）。
   * 由 _dispatchNode 在失败且需要重规划时调用。
   */
  enqueue(node: TaskNode, reason: string): void {
    if (!this.metaAgent) return;

    const isReActTimeout = (reason).includes("Exceeded max loops");
    if (isReActTimeout) return;

    const count = this.replanCount.get(node.id) ?? 0;
    if (count >= this.config.maxReplanPerNode) return;

    this.replanQueue.push({ node, reason, count });
    this.observer.emit({
      type: PipelineEventType.NodeReplanQueued,
      priority: PipelinePriority.HIGH,
      payload: { nodeId: node.id, reason, attempt: count + 1 },
      timestamp: Date.now(),
      notificationType: "WARNING",
    });
  }

  /**
   * 尝试发射后台 replan 批次。
   * 检查全局上限，未触顶则并行处理所有入队项。
   * @returns Promise（调用方可 await 或 fire-and-forget），上限触顶时返回 null
   */
  tryFireReplan(): Promise<void> | null {
    if (this.totalReplans >= this.config.maxTotalReplans) {
      this._emitBudgetExhausted();
      return null;
    }
    return this._drain().then(() => {
      // @fix P0-2: _drain 执行后若预算被恰好耗尽，同步发射 SchedulerReplanLimit。
      //   maxReplanPerNode == maxTotalReplans 时 per-node 限制会阻止后续 enqueue，
      //   导致 tryFireReplan 不再被调用，事件永不发射。
      if (this.totalReplans >= this.config.maxTotalReplans) {
        this._emitBudgetExhausted();
      }
    });
  }

  /** 发射 SchedulerReplanLimit 并清空队列，防止 Scheduler 空转 */
  private _emitBudgetExhausted(): void {
    this.observer.emit({
      type: PipelineEventType.SchedulerReplanLimit,
      priority: PipelinePriority.CRITICAL,
      payload: {
        totalReplans: this.totalReplans,
        maxReplans: this.config.maxTotalReplans,
        deferred: this.replanQueue.length,
      },
      timestamp: Date.now(),
      notificationType: "WARNING",
    });
    this.replanQueue.length = 0;
  }

  /**
   * 执行结束后解析重规划链。
   * 若任意后代节点成功，视原始节点为成功。
   * @returns [updatedCompleted, updatedFailed] 修正后的计数
   */
  resolveChains(allResults: NodeResult[]): [completed: number, failed: number] {
    let completed = 0;
    let failed = allResults.filter((r) => !r.success).length;

    for (const [origId, newIds] of this.replanMap) {
      const origIdx = allResults.findIndex((r) => r.nodeId === origId);
      if (origIdx < 0) continue;

      if (this._isChainSuccessful(newIds, allResults)) {
        if (allResults[origIdx].success === false) {
          failed--;
          completed++;
        }
        allResults[origIdx] = {
          nodeId: origId,
          success: true,
          output: "Replanned: task completed by new nodes",
        };
      }
    }
    return [completed, failed];
  }

  /**
   * 清零所有状态（每次 executeAll() 结束后调用）。
   */
  reset(): void {
    this.replanMap.clear();
    this.replanCount.clear();
    this.totalReplans = 0;
    this.replanQueue.length = 0;
  }

  // ── 内部实现 ─────────────────────────────────

  private async _drain(): Promise<void> {
    if (!this.metaAgent) {
      const orphanCount = this.replanQueue.length;
      this.replanQueue.length = 0;
      if (orphanCount > 0) {
        this.observer.emit({
          type: PipelineEventType.SchedulerReplanNoMetaAgent,
          priority: PipelinePriority.CRITICAL,
          payload: { orphanCount, hint: "MetaAgent not configured; replan queue drained silently" },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      }
      return;
    }

    const fullBatch = this.replanQueue.splice(0); // 原子取出

    const available = this.config.maxTotalReplans - this.totalReplans;
    if (available <= 0) return;
    const batch = fullBatch.slice(0, available);
    this.totalReplans += batch.length;

    const promises = batch.map(async (item) => {
      const count = item.count + 1;
      this.replanCount.set(item.node.id, count);

      this.observer.emit({
        type: PipelineEventType.NodeReplan,
        priority: PipelinePriority.CRITICAL,
        payload: { nodeId: item.node.id, reason: item.reason, attempt: count },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });

      const result = await this.metaAgent!.requestReplan(
        item.node, item.reason, count, undefined, this.config.maxReplanPerNode,
      );

      const newIds: string[] = [];
      for (const n of result.nodes) {
        this.board.addNode(n);
        this.replanCount.set(n.id, count);
        newIds.push(n.id);
      }
      this.replanMap.set(item.node.id, newIds);

      if (result.impactScope === "subtree") {
        this.board.removeSubtree(item.node.id);
      } else {
        this.board.removeNode(item.node.id);
      }
    });

    const results = await Promise.allSettled(promises);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        const nodeId = batch[i]?.node.id ?? "unknown";
        this.observer.emit({
          type: PipelineEventType.SchedulerReplanFailed,
          priority: PipelinePriority.CRITICAL,
          payload: { nodeId, error: String(r.reason).slice(0, 200) },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      }
    }
  }

  private _isChainSuccessful(nodeIds: string[], allResults: NodeResult[], visited = new Set<string>()): boolean {
    for (const id of nodeIds) {
      if (visited.has(id)) continue;
      visited.add(id);

      const result = allResults.find((r) => r.nodeId === id);
      if (result?.success) return true;

      const childIds = this.replanMap.get(id);
      if (childIds && childIds.length > 0) {
        if (this._isChainSuccessful(childIds, allResults, visited)) return true;
      }
    }
    return false;
  }
}
