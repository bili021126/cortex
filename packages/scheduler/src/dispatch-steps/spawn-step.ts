import { AgentStatus, PipelineEventType, PipelinePriority, type AgentType } from "@cortex/shared";
import type { DispatchCtx, IDispatchStep } from "./types.js";
import { ManifoldGate } from "./manifold-gate.js";

/**
 * SpawnStep —— 池化生成 + 状态初始化（mHC 流约束版）。
 *
 * 职责：
 * 1. ManifoldGate.acquire() 获取流约束槽位（mHC 流形约束——同类型并发 ≤ maxInstances）
 * 2. pool.spawn() 创建 Agent 实例
 * 3. agent.setPool() 注入 Pool 引用（方案 B：状态所有权归一）
 * 4. wakeup（Created → Awake）
 * 5. 状态校验（仅 Awake/Active 可执行）
 *
 * 失败时 board.release + board.failNode + observer.emit + ctx.result 置错误。
 * ManifoldGate 槽位在失败时立即释放，成功时由 CleanupStep 释放。
 *
 * RLM 子任务（isRlmSubtask=true）不走流约束——子任务不占主配额，
 * 通过 pool.spawnSubtask() 独立通道执行。
 *
 * @since mHC-Constrained Dispatch Pipeline
 */
export class SpawnStep implements IDispatchStep {
  readonly name = "Spawn";

  /** 流控获取超时（默认 60s） */
  private readonly _acquireTimeoutMs: number;

  constructor(acquireTimeoutMs: number = 60_000) {
    this._acquireTimeoutMs = acquireTimeoutMs;
  }

  /**
   * 视角失败统一收尾（多视角 spawn 自愈语义）：
   * - 普通节点：release + failNode（节点整体失败，无可挽救视角）
   * - 多视角节点：仅 release 失败视角，其他视角继续执行；若这是最后一个认领视角
   *   （claimedBy 已空）→ failNode（全部失败，不可恢复）
   * 并发安全：同步无 await，Node 单线程天然原子。
   */
  private _settlePerspectiveFailure(ctx: DispatchCtx): DispatchCtx {
    const { board, node, agentType } = ctx;
    board.release(node.id, agentType as AgentType);
    const after = board.getNode(node.id);
    const isLast = !!after && after.claimedBy.length === 0;
    if (!node.needsMultiPerspective || isLast) {
      board.failNode(node.id);
    }
    return ctx;
  }

  async run(ctx: DispatchCtx): Promise<DispatchCtx> {
    const { agentType, agent, pool, observer, node } = ctx;

    if (!agentType || !agent) {
      // R12-B3 配套：claim 未成功（lease 撞——跳过本轮等回收）——不失败不 replan
      // （此前失败→failNode→replan→再 claim→再失败→无限循环→OOM）
      return { ...ctx };
    }

    const instanceId = `${agentType}-${node.id}`;
    const isSubtask = node.isRlmSubtask === true;
    const effectiveTimeout = node.acquireTimeoutMs ?? this._acquireTimeoutMs;
    let slotAcquired = false;

    if (!isSubtask) {
      slotAcquired = await ManifoldGate.acquire(agentType as AgentType, effectiveTimeout);
      if (!slotAcquired) {
        this._settlePerspectiveFailure(ctx);
        observer.emit({
          type: PipelineEventType.NodeSpawnFailed,
          priority: PipelinePriority.HIGH,
          payload: {
            nodeId: node.id,
            agentType: agentType as AgentType,
            reason: `流控槽位等待超时 (${this._acquireTimeoutMs}ms)——同类型 Agent 全部阻塞`,
          },
          timestamp: Date.now(),
        });
        return {
          ...ctx,
          result: {
            nodeId: node.id,
            agentType: agentType as AgentType,
            success: false,
            error: `Manifold gate timeout for ${agentType} after ${this._acquireTimeoutMs}ms`,
          },
        };
      }
    }

    // 1. Spawn——子任务走独立通道，不占主配额
    const spawned = isSubtask
      ? pool.spawnSubtask(agentType as AgentType, instanceId)
      : pool.spawn(agentType as AgentType, instanceId);
    if (!spawned) {
      if (slotAcquired) ManifoldGate.release(agentType as AgentType);
      this._settlePerspectiveFailure(ctx);
      observer.emit({
        type: PipelineEventType.NodeSpawnFailed,
        priority: PipelinePriority.HIGH,
        payload: { nodeId: node.id, agentType: agentType as AgentType, reason: "pool_exhausted" },
        timestamp: Date.now(),
      });
      return {
        ...ctx,
        result: {
          nodeId: node.id,
          agentType: agentType as AgentType,
          success: false,
          error: `Agent pool exhausted for ${agentType}`,
        },
      };
    }

    // 2. 方案 B：Agent 状态所有权归一——spawn 后注入 Pool
    agent.setPool?.(pool, instanceId);

    // 3. 唤醒 Agent：Created → Awake
    if (pool.getStatus(instanceId) === AgentStatus.Created) {
      pool.setStatus(instanceId, AgentStatus.Awake);
    }

    // 4. 状态校验
    if (agent.status !== AgentStatus.Awake && agent.status !== AgentStatus.Active) {
      if (slotAcquired) ManifoldGate.release(agentType as AgentType);
      this._settlePerspectiveFailure(ctx);
      return {
        ...ctx,
        result: {
          nodeId: node.id,
          agentType: agentType as AgentType,
          success: false,
          error: `Agent ${agentType} is ${agent.status}, cannot execute`,
        },
      };
    }

    return {
      ...ctx,
      instanceId,
    };
  }
}
