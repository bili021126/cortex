import { PipelineEventType, PipelinePriority, type IPipelineObserver, type NodeResult, type TaskNode } from "@cortex/shared";
import { SCHEDULER_MAX_REPLAN_PER_NODE, SCHEDULER_MAX_TOTAL_REPLANS } from "@cortex/config";
import type { ITaskBoard } from "./task-board.js";
import type { EngineConfig } from "@cortex/config";

/**
 * ReplanItem —— 重规划入队项。
 *
 * @usedBy ReplanManager.enqueue()
 * - count: 该节点已重规划次数
 * - disposition: "failure"（执行失败）| "boundary_violation"（Agent越界）
 */
export interface ReplanItem {
  node: TaskNode;
  reason: string;
  count: number;
  /** 处置类型："failure"（默认）| "boundary_violation"（Agent越界） */
  disposition?: "failure" | "boundary_violation";
}

/**
 * IReplanProvider —— 重规划回调解耦接口。
 *
 * 替代直接依赖 MetaAgent 具体类，通过此接口解耦。
 * engine 侧在构造时传入实现了此接口的适配器（包装 MetaAgent）。
 *
 * @since @cortex/scheduler 独立包
 */
export interface IReplanProvider {
  requestReplan(
    node: TaskNode,
    reason: string,
    count: number,
    currentDepth?: number,
    maxReplanPerNode?: number,
  ): Promise<{ nodes: TaskNode[]; impactScope: "local" | "subtree"; error?: string }>;

  requestBoundaryReplan(
    node: TaskNode,
    reason: string,
    count: number,
    currentDepth?: number,
    maxReplanPerNode?: number,
  ): Promise<{ nodes: TaskNode[]; impactScope: "local" | "subtree"; error?: string }>;
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
 *
 * @migrated 从 @cortex/engine 提取，MetaAgent 依赖改为 IReplanProvider 接口
 */
export class ReplanManager {
  private replanCount = new Map<string, number>();
  private replanQueue: ReplanItem[] = [];
  private totalReplans = 0;
  private replanMap = new Map<string, string[]>(); // originalId → replan-generated new ids

  /**
   * @param board TaskBoard 引用
   * @param observer PipelineObserver 引用
   * @param replanProvider 可选——重规划回调提供者（如 MetaAgent 适配器）。缺则 replan 静默排空
   * @param config 引擎配置
   */
  constructor(
    private readonly board: ITaskBoard,
    private readonly observer: IPipelineObserver,
    private readonly replanProvider: IReplanProvider | undefined,
    private readonly config: Required<EngineConfig>,
  ) {}

  /** 是否有待处理的重规划任务 */
  get hasPending(): boolean {
    return this.replanQueue.length > 0;
  }

  /** 获取指定节点的重规划尝试次数 */
  getReplanCount(nodeId: string): number {
    return this.replanCount.get(nodeId) ?? 0;
  }

  /**
   * 将节点入队重规划队列。
   * @param node 失败/越界节点
   * @param reason 失败原因或违规描述
   * @param disposition 处置类型："failure"（默认）| "boundary_violation"
   */
  enqueue(node: TaskNode, reason: string, disposition: "failure" | "boundary_violation" = "failure"): void {
    if (!this.replanProvider) return;

    const isReActTimeout = (reason).includes("Exceeded max loops");
    if (isReActTimeout) return;

    const count = this.replanCount.get(node.id) ?? 0;
    if (count >= SCHEDULER_MAX_REPLAN_PER_NODE) return;

    this.replanQueue.push({ node, reason, count, disposition });
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
    if (this.totalReplans >= SCHEDULER_MAX_TOTAL_REPLANS) {
      // 发射 SchedulerReplanLimit 事件后降级（小范围修复），不直接放弃
      this.observer.emit({
        type: PipelineEventType.SchedulerReplanLimit,
        priority: PipelinePriority.CRITICAL,
        payload: {
          totalReplans: this.totalReplans,
          maxReplans: SCHEDULER_MAX_TOTAL_REPLANS,
          deferred: this.replanQueue.length,
        },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
      return this._drainDegraded();
    }
    return this._drain().then(() => {
      if (this.totalReplans >= SCHEDULER_MAX_TOTAL_REPLANS) {
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
        maxReplans: SCHEDULER_MAX_TOTAL_REPLANS,
        deferred: this.replanQueue.length,
      },
      timestamp: Date.now(),
      notificationType: "WARNING",
    });
    this.replanQueue.length = 0;
  }

  /**
   * 降级 drain：配额耗尽时的小范围修复（不占 replan 配额，local scope only）。
   * maxReplanPerNode 压缩到 1，impactScope 限制为 local。
   */
  private async _drainDegraded(): Promise<void> {
    const provider = this.replanProvider;
    if (!provider) {
      this.replanQueue.length = 0;
      return;
    }

    const batch = this.replanQueue.splice(0);
    if (batch.length === 0) return;

    const promises = batch.map(async (item) => {
      const count = item.count + 1;
      this.replanCount.set(item.node.id, count);

      // 降级：maxReplanPerNode=1，只做 local 范围修复
      const result = item.disposition === "boundary_violation"
        ? await provider.requestBoundaryReplan(item.node, item.reason, count, undefined, 1)
        : await provider.requestReplan(item.node, item.reason, count, undefined, 1);

      const newIds: string[] = [];
      for (const n of result.nodes) {
        n.isRlmSubtask = true;
        this.board.addNode(n);
        this.replanCount.set(n.id, 0);
        newIds.push(n.id);
      }
      this.replanMap.set(item.node.id, newIds);

      if (result.impactScope === "subtree") {
        this.board.removeSubtree(item.node.id);
      } else {
        this.board.removeNode(item.node.id);
      }
    });

    await Promise.allSettled(promises);
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
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (allResults[origIdx]!.success === false) {
          failed--;
          completed++;
        }
        allResults[origIdx] = {
          nodeId: origId,
          success: true,
          output: this._getMergedOutput(newIds, allResults),
        };
      }
    }
    return [completed, failed];
  }

  private _getMergedOutput(newIds: string[], allResults: NodeResult[]): string {
    const parts: string[] = [];
    for (const id of newIds) {
      const r = allResults.find((rr) => rr.nodeId === id);
      if (r?.success && r.output) {
        parts.push("[" + id + "] " + r.output.slice(0, 2000));
      }
    }
    if (parts.length === 0) return "Replanned: task completed by new nodes";
    return "[Replanned - " + newIds.length + " sub-tasks]\n" + parts.join("\n---\n");
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

  /**
   * 处理节点延迟事件。
   * 'wait'  → 只记录，不触发重规划
   * 'extend' → 给该 node 额外的时间（加时），不触发重规划
   * 与 onNodeFailed 的区别：不触发 replan 入队。
   */
  onNodeDelayed(_nodeId: string, _elapsed: number, action: 'wait' | 'extend'): void {
    // 'wait'：仅记录，无实际操作
    if (action === 'wait') return;
    // 'extend'：预留扩展点——未来可在此延长节点的超时阈值
    if (action === 'extend') return;
  }

  // ── 内部实现 ─────────────────────────────────

  private async _drain(): Promise<void> {
    const provider = this.replanProvider;
    if (!provider) {
      const orphanCount = this.replanQueue.length;
      this.replanQueue.length = 0;
      if (orphanCount > 0) {
        this.observer.emit({
          type: PipelineEventType.SchedulerReplanNoMetaAgent,
          priority: PipelinePriority.CRITICAL,
          payload: { orphanCount, hint: "ReplanProvider not configured; replan queue drained silently" },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      }
      return;
    }

    const fullBatch = this.replanQueue.splice(0); // 原子取出

    const available = SCHEDULER_MAX_TOTAL_REPLANS - this.totalReplans;
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

      const result = item.disposition === "boundary_violation"
        ? await provider.requestBoundaryReplan(
            item.node, item.reason, count, undefined, SCHEDULER_MAX_REPLAN_PER_NODE,
          )
        : await provider.requestReplan(
            item.node, item.reason, count, undefined, SCHEDULER_MAX_REPLAN_PER_NODE,
          );

      const newIds: string[] = [];
      for (const n of result.nodes) {
        // 标记为 RLM 子任务——走 pool.spawnSubtask() 独立配额
        n.isRlmSubtask = true;
        this.board.addNode(n);
        this.replanCount.set(n.id, 0);
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
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const r = results[i]!;
      if (r.status === "rejected") {
        this.totalReplans -= 1; // 回退预扣配额
        const nodeId = batch[i]?.node.id ?? "unknown";
        this.observer.emit({
          type: PipelineEventType.SchedulerReplanFailed,
          priority: PipelinePriority.CRITICAL,
          payload: { nodeId, error: String((r as PromiseRejectedResult).reason).slice(0, 200) },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      }
    }
  }

  private _isChainSuccessful(nodeIds: string[], allResults: NodeResult[]): boolean {
    const visited = new Set<string>();
    const stack = [...nodeIds];
    while (stack.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const result = allResults.find((r) => r.nodeId === id);
      if (result?.success) return true;

      const childIds = this.replanMap.get(id);
      if (childIds && childIds.length > 0) {
        for (let i = childIds.length - 1; i >= 0; i--) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          stack.push(childIds[i]!);
        }
      }
    }
    return false;
  }
}
