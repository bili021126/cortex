import { AgentType as AT, AGENT_TAGS, PipelinePriority, PipelineEventType, type AgentType } from "@cortex/shared";
import type { DispatchCtx, IDispatchStep } from "./types.js";
import { findMatchingAgent } from "../core/agent-matcher.js";
import { isTestEnv as checkTestEnv, CLAIM_RETRY_LIMIT, CLAIM_LEASE_MS } from "@cortex/config";

/**
 * ClaimStep —— 认领节点。
 *
 * 职责：
 * 1. 从 agents 中查找第一个标签匹配的 Agent 类型
 * 2. 非标准 AgentType 诊断（observer + console.warn）
 * 3. board.claim() 认领节点
 *
 * 失败时设置 ctx.result 为错误结果，后续 Step 应跳过。
 */
export class ClaimStep implements IDispatchStep {
  readonly name = "Claim";

  async run(ctx: DispatchCtx): Promise<DispatchCtx> {
    const { agents, board, node, observer } = ctx;

    // 1. 查找匹配 Agent
    const agentType = findMatchingAgent(agents, node);
    if (!agentType) {
      board.failNode(node.id);
      return {
        ...ctx,
        result: {
          nodeId: node.id,
          success: false,
          error: `No agent matches tags: ${node.tags.join(", ")}`,
        },
      };
    }

    const agent = agents.get(agentType);
    if (!agent) {
      board.failNode(node.id);
      return {
        ...ctx,
        result: {
          nodeId: node.id,
          agentType: agentType as AgentType,
          success: false,
          error: `No agent registered for type: ${agentType}`,
        },
      };
    }

    // 2. 非标准 AgentType 诊断
    const knownTypes = new Set<string>(Object.values(AT) as string[]);
    if (!knownTypes.has(agentType) && !node.needsMultiPerspective) {
      let matchedCount = 0;
      for (const [type, atags] of Object.entries(AGENT_TAGS)) {
        if (agents.has(type) && node.tags.some((tag) => (atags as readonly string[]).includes(tag))) {
          matchedCount++;
        }
      }
      if (!checkTestEnv()) {
        observer.emit({
          type: PipelineEventType.SchedulerNonstandardType,
          priority: PipelinePriority.NORMAL,
          payload: {
            nodeId: node.id,
            nodeType: node.type,
            assigned: agentType,
            matchedCount,
            totalAgents: agents.size,
          },
          timestamp: Date.now(),
        });

      }
    }

    // 3. 认领节点
    const claimed = board.claim(node.id, agentType as AgentType);
    if (!claimed) {
      // R12-B3 替代（重试上限）：claim 撞 lease（崩溃残留/活跃续期——临时状态）——上限内跳过本轮等回收
      // （claim-skipped 豁免——不 replan 不 NodeFailed——管线中断），超上限（疑似永久卡死）才 failNode
      const retries = board.getClaimRetries(node.id);
      // R13-B3：时间基判定——撞 lease 超过 CLAIM_LEASE_MS（等不到回收）或轮次超上限（保险）才 failNode；
      // 此前计轮次——崩溃残留场景每轮毫秒级，3 轮即越限，120s lease 回收窗口名存实亡
      const firstAt = board.getClaimFirstAt(node.id);
      const leaseElapsed = firstAt > 0 ? Date.now() - firstAt : 0;
      if (leaseElapsed > CLAIM_LEASE_MS || retries >= CLAIM_RETRY_LIMIT) {
        board.failNode(node.id);
        board.resetClaimRetries(node.id);
        return {
          ...ctx,
          result: {
            nodeId: node.id,
            agentType: agentType as AgentType,
            success: false,
            error: `Failed to claim node ${node.id} for ${agentType}（重试 ${retries} 次仍撞 lease）`,
          },
        };
      }
      board.incrementClaimRetry(node.id);
      return { ...ctx };
    }
    // claim 成功——重置重试计数（下次撞 lease 重新计数）
    board.resetClaimRetries(node.id);

    return {
      ...ctx,
      agentType,
      agent,
    };
  }
}
