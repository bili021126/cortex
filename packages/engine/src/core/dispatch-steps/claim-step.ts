import { AgentType as AT, AGENT_TAGS, PipelinePriority, PipelineEventType, type AgentType } from "@cortex/shared";
import type { DispatchCtx, IDispatchStep } from "./types.js";
import { findMatchingAgent } from "../agent-matcher.js";

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
    const { agents, board, node, observer, isTestEnv } = ctx;

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
      if (!isTestEnv) {
        observer.emit({
          type: PipelineEventType.SchedulerNonstandardType,
          priority: PipelinePriority.NORMAL,
          payload: {
            nodeId: node.id,
            nodeType: node.type,
            agentType,
            matchedCount,
            totalAgents: agents.size,
          },
          timestamp: Date.now(),
        });
        console.warn(
          `[scheduler] 节点 ${node.id} type="${node.type}" 非标准 AgentType——` +
          `仅 ${matchedCount} 个 Agent 可匹配 (已分配 ${agentType})，` +
          `其余 ${agents.size - matchedCount} 个空闲。` +
          `建议 MetaAgent 将大任务拆分为 type="review"+"ops"+"code"... 的独立节点以利用并行。`
        );
      }
    }

    // 3. 认领节点
    const claimed = board.claim(node.id, agentType as AgentType);
    if (!claimed) {
      board.failNode(node.id);
      return {
        ...ctx,
        result: {
          nodeId: node.id,
          agentType: agentType as AgentType,
          success: false,
          error: `Failed to claim node ${node.id} for ${agentType}`,
        },
      };
    }

    return {
      ...ctx,
      agentType,
      agent,
    };
  }
}
