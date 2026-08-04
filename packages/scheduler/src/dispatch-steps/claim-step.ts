import { AgentType as AT, AGENT_TAGS, PipelinePriority, PipelineEventType, type AgentType } from "@cortex/shared";
import type { DispatchCtx, IDispatchStep } from "./types.js";
import { findMatchingAgent } from "../core/agent-matcher.js";
import { isTestEnv as checkTestEnv } from "@cortex/config";

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
      // 回滚 R12-B3：claim 失败恢复 failNode（B3 的跳过导致节点悬置 claimed——completed/failed 计数为 0；
      // 且跳过不触发 replan 配额，多轮空转。failNode 后 replan 配额正常拦截（B3 前 CI 绿、无 OOM 风暴）
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
