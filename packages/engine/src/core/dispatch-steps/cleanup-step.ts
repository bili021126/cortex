import { AgentStatus, PipelineEventType, PipelinePriority, type AgentType } from "@cortex/shared";
import type { DispatchCtx, IDispatchStep } from "./types.js";
import { ManifoldGate } from "./manifold-gate.js";

/**
 * CleanupStep —— 清理与落盘（mHC 流约束版）。
 *
 * 职责（始终执行，即使 ExecuteStep 失败）：
 * 1. ManifoldGate 释放：先释放 mHC 流约束槽位，唤醒下一个等待者（FIFO）——优先于 destroy，提高吞吐
 * 2. Pool 生命周期：drain → destroy（优雅降级：Awake/Active → Draining → Destroyed）
 * 3. TaskBoard 落盘：board.complete() 写入结果
 * 4. PipelineObserver 事件：仅成功时发射 NodeComplete
 *
 * ManifoldGate 槽位在 SpawnStep.acquire() → CleanupStep.release() 配对，
 * 形成 mHC 双重随机矩阵约束：sum(active_per_type) ≤ maxInstances。
 * RLM 子任务（isRlmSubtask=true）不参与流约束——它们不占主配额。
 *
 * 技能反馈闭环已从调度管线中移除——技能是 Agent 自主拉取+评价回流，
 * 不通过强制注入模式执行。
 *
 * @since mHC-Constrained Dispatch Pipeline
 */
export class CleanupStep implements IDispatchStep {
  readonly name = "Cleanup";

  async run(ctx: DispatchCtx): Promise<DispatchCtx> {
    const { agentType, board, pool, observer, node, instanceId, result } = ctx;

    if (!agentType || !instanceId || !result) {
      // 前置步骤失败或未初始化——静默返回
      // ManifoldGate 槽位已在 SpawnStep 失败路径中释放
      return ctx;
    }

    // 1. mHC 流形约束释放——优先释放槽位，提高系统吞吐
    const isSubtask = node.isRlmSubtask === true;
    if (!isSubtask) {
      ManifoldGate.release(agentType as AgentType);
    }

    // 2. Pool 生命周期：优雅降级 + 销毁
    try {
      const preStatus = pool.getStatus(instanceId);
      if (preStatus === AgentStatus.Awake || preStatus === AgentStatus.Active) {
        pool.setStatus(instanceId, AgentStatus.Draining);
      }
      pool.destroy(agentType as AgentType, instanceId);
    } catch (e) {
      observer.emit({
        type: PipelineEventType.PoolDestroyFailed,
        priority: PipelinePriority.HIGH,
        payload: { agentType, instanceId, error: String(e).slice(0, 200) },
        timestamp: Date.now(),
      });
    }

    // 3. TaskBoard 落盘（即使 execute 抛异常也要落盘，防节点卡 claimed）
    board.complete(node.id, agentType as AgentType, result.success, result.output, result.error);

    // 4. 仅成功时发射 node.complete（失败由 _dispatchNode 统一发射 node.failed）
    if (result.success) {
      observer.emit({
        type: PipelineEventType.NodeComplete,
        priority: PipelinePriority.HIGH,
        payload: { nodeId: node.id, agentType, success: true as const, output: result.output },
        timestamp: Date.now(),
      });
    }

    return ctx;
  }
}
