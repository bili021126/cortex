import type { AgentType } from "@cortex/shared";
import type { DispatchCtx, IDispatchStep } from "./types.js";
import { DEFAULT_CLI_CHAT_MODEL } from "@cortex/config";

/**
 * ExecuteStep —— Agent 执行。
 *
 * 职责：
 * 1. 从 ctx 获取 enrichedNode（含注入技能）或原始 node
 * 2. 调用 agent.execute() 执行任务
 * 3. 异常不向外抛——捕获后存储为失败结果
 *
 * ExecuteStep 始终生成 ctx.result（成功或失败），
 * 确保 CleanupStep 在任何情况下都能运行。
 */
export class ExecuteStep implements IDispatchStep {
  readonly name = "Execute";

  async run(ctx: DispatchCtx): Promise<DispatchCtx> {
    const { agent, agentType, enrichedNode, node, models } = ctx;

    if (!agent || !agentType) {
      return {
        ...ctx,
        result: {
          nodeId: node.id,
          success: false,
          error: "ExecuteStep: agent or agentType not set",
        },
      };
    }

    // 模型解析：优先使用 ctx.model，回退到 models 按 agentType 查找，最后兜底
    const model = ctx.model ?? models.get(agentType) ?? DEFAULT_CLI_CHAT_MODEL;

    const executeNode = enrichedNode ?? node;

    let result;
    try {
      result = await agent.execute(executeNode, model);
    } catch (e) {
      result = {
        nodeId: node.id,
        agentType: agentType as AgentType,
        success: false,
        error: String(e),
      };
    }

    return { ...ctx, result };
  }
}
