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

  /** 流控获取超时（默认 60s，mHC 恒等保持——超时后优雅失败而非无限等待） */
  private readonly _acquireTimeoutMs: number;

  constructor(acquireTimeoutMs: number = 60_000) {
    this._acquireTimeoutMs = acquireTimeoutMs;
  }

  async run(ctx: DispatchCtx): Promise<DispatchCtx> {
    const { agentType, agent, board, pool, observer, node } = ctx;

    if (!agentType || !agent) {
      // 不应发生——ClaimStep 已完成
      return {
        ...ctx,
        result: { nodeId: node.id, success: false, error: "SpawnStep: agentType or agent not set" },
      };
    }

    const instanceId = `${agentType}-${node.id}`;
    // isRlmSubtask 已是 TaskNode 的直接字段（DispatchCtx.node: TaskNode），无需断言
    const isSubtask = node.isRlmSubtask === true;
    // per-node 超时覆盖 → 回退全局默认值
    const effectiveTimeout = node.acquireTimeoutMs ?? this._acquireTimeoutMs;
    // RLM 子任务（递归拆解产物）不走流约束——它们不占主配额
    let slotAcquired = false;
    if (!isSubtask) {
      slotAcquired = await ManifoldGate.acquire(agentType as AgentType, effectiveTimeout);
      if (!slotAcquired) {
        // 流控超时——同类型 Agent 全部阻塞，优雅失败
        board.release(node.id, agentType as AgentType);
        board.failNode(node.id);
        observer.emit({
          type: PipelineEventType.NodeSpawnFailed,
          priority: PipelinePriority.HIGH,
          payload: {
            nodeId: node.id,
            agentType,
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
      // 池配额耗尽（配置错误或竞态）——释放流控槽位
      if (slotAcquired) ManifoldGate.release(agentType as AgentType);
      board.release(node.id, agentType as AgentType);
      board.failNode(node.id);
      observer.emit({
        type: PipelineEventType.NodeSpawnFailed,
        priority: PipelinePriority.HIGH,
        payload: { nodeId: node.id, agentType, reason: "pool_exhausted" },
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
    const agentWithPool = agent as unknown as { setPool?: (pool: unknown, instanceId: string) => void };
    if (typeof agentWithPool.setPool === 'function') {
      agentWithPool.setPool(pool, instanceId);
    }

    // 3. 唤醒 Agent：Created → Awake
    if (pool.getStatus(instanceId) === AgentStatus.Created) {
      pool.setStatus(instanceId, AgentStatus.Awake);
    }

    // 4. 状态校验
    if (agent.status !== AgentStatus.Awake && agent.status !== AgentStatus.Active) {
      // 状态非法——释放流控槽位 + 池实例
      if (slotAcquired) ManifoldGate.release(agentType as AgentType);
      board.release(node.id, agentType as AgentType);
      board.failNode(node.id);
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
