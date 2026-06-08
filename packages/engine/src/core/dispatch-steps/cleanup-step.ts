import { AgentStatus, PipelineEventType, PipelinePriority, type AgentType } from "@cortex/shared";
import type { DispatchCtx, IDispatchStep } from "./types.js";

/**
 * CleanupStep —— 清理与落盘。
 *
 * 职责（始终执行，即使 ExecuteStep 失败）：
 * 1. Pool 生命周期：drain → destroy（优雅降级：Awake/Active → Draining → Destroyed）
 * 2. TaskBoard 落盘：board.complete() 写入结果
 * 3. PipelineObserver 事件：仅成功时发射 NodeComplete
 *
 * 技能反馈闭环已从调度管线中移除——技能是 Agent 自主拉取+评价回流，
 * 不通过强制注入模式执行。
 *
 * 此步骤合并了原 _executeAndCleanup 中的 execute 后逻辑。
 */
export class CleanupStep implements IDispatchStep {
  readonly name = "Cleanup";

  async run(ctx: DispatchCtx): Promise<DispatchCtx> {
    const { agentType, board, pool, observer, node, instanceId, result } = ctx;

    if (!agentType || !instanceId || !result) {
      // 前置步骤失败或未初始化——静默返回
      return ctx;
    }

    // 1. Pool 生命周期：优雅降级 + 销毁
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

    // 2. TaskBoard 落盘（即使 execute 抛异常也要落盘，防节点卡 claimed）
    board.complete(node.id, agentType as AgentType, result.success, result.output, result.error);

    // 3. 仅成功时发射 node.complete（失败由 _dispatchNode 统一发射 node.failed）
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
