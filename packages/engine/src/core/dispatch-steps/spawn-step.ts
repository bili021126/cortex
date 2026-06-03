import { AgentStatus, PipelinePriority, PipelineEventType } from "@cortex/shared";
import type { AgentType } from "@cortex/shared";
import type { DispatchCtx, IDispatchStep } from "./types.js";

/**
 * SpawnStep —— 池化生成 + 状态初始化。
 *
 * 职责：
 * 1. pool.spawn() 创建 Agent 实例
 * 2. agent.setPool() 注入 Pool 引用（方案 B：状态所有权归一）
 * 3. wakeup（Created → Awake）
 * 4. 状态校验（仅 Awake/Active 可执行）
 *
 * 失败时 board.release + board.failNode + observer.emit + ctx.result 置错误。
 */
export class SpawnStep implements IDispatchStep {
  readonly name = "Spawn";

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

    // 1. Spawn
    const spawned = pool.spawn(agentType as AgentType, instanceId);
    if (!spawned) {
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
