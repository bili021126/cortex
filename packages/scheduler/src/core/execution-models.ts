/**
 * execution-models —— 调度四抽象之实现（由 scheduling-implementations.ts 拆分，2026-06-20 SCH-1）。
 *
 * 拆分自原 1457 行单文件：strategies / drivers / execution-models / model-routers。
 */

import { AgentStatus, PipelineEventType, PipelinePriority, type AgentType, type NodeResult } from "@cortex/shared";
import { runDispatchPipeline } from "./drivers.js";
import type { IExecutionModel, ExecutionContext } from "./scheduling-types.js";
import { ClaimStep } from "../dispatch-steps/claim-step.js";
import { SpawnStep } from "../dispatch-steps/spawn-step.js";
import { ExecuteStep } from "../dispatch-steps/execute-step.js";
import { CleanupStep } from "../dispatch-steps/cleanup-step.js";
import { BoundaryGuardStep } from "../dispatch-steps/boundary-guard-step.js";
import type { DispatchCtx, IDispatchStep } from "../dispatch-steps/types.js";

export class PipelineModel implements IExecutionModel {
  readonly name = "pipeline";

  async dispatchSingle(ctx: ExecutionContext): Promise<NodeResult> {
    const { node, agents, models, board, pool, observer, isTestEnv: _isTestEnv } = ctx;
    const dispatchCtx: DispatchCtx = {
      agents, models, board, pool, observer,
      isTestEnv: _isTestEnv,
      node,
    };

    const steps: IDispatchStep[] = [
      new ClaimStep(),
      new SpawnStep(),
      new ExecuteStep(),
      new BoundaryGuardStep(),
      new CleanupStep(),
    ];

    return await runDispatchPipeline(dispatchCtx, steps);
  }

  async dispatchMulti(ctx: ExecutionContext): Promise<NodeResult> {
    const { node, agents, models, board, pool, observer, strategy, isTestEnv: _isTestEnv } = ctx;
    const agentTypes = strategy.findAllMatchingAgents(node, agents);

    if (agentTypes.length === 0) {
      board.failNode(node.id);
      return { nodeId: node.id, success: false, error: `No agents match multi-perspective node ${node.id}` };
    }

    const promises = agentTypes.map(async (at) => {
      try {
        const agent = agents.get(at);
        if (!agent) return null;
        if (agent.status !== AgentStatus.Awake && agent.status !== AgentStatus.Active) return null;

        if (!board.claim(node.id, at as AgentType)) return null;

        const dispatchCtx: DispatchCtx = {
          agents, models, board, pool, observer,
          isTestEnv: _isTestEnv,
          node,
          agentType: at,
          agent,
          model: models.get(at) ?? "mock",
        };

        const steps: IDispatchStep[] = [new SpawnStep(), new ExecuteStep(), new BoundaryGuardStep(), new CleanupStep()];
        const res = await runDispatchPipeline(dispatchCtx, steps);
        // 多视角自愈：spawn 阶段失败（未写入节点 results）的视角视为未参与执行，
        // 过滤掉不参与整体 success 判定——仅 execute 失败才使整体失败（dispatch-multi 契约 Test 3）
        if (node.needsMultiPerspective && res && !res.success) {
          const executed = board.getNode(node.id)?.results.some((r) => r.agentType === at);
          if (!executed) return null;
        }
        return res;
      } catch (err) {
        // 单 agent 异常不影响其他 agent——CleanupStep 已在 runDispatchPipeline 的 finally 中执行
        observer.emit({
          type: PipelineEventType.InfraComponentDegraded,
          priority: PipelinePriority.HIGH,
          payload: { operation: "dispatch-multi-agent-crash", detail: String(err) },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
        return null;
      }
    });

    const rawResults = await Promise.allSettled(promises);
    const results = rawResults
      .map((r) => r.status === "fulfilled" ? r.value : null)
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (results.length === 0) {
      board.failNode(node.id);
      return { nodeId: node.id, success: false, error: "All agents failed to claim multi-perspective node" };
    }

    const combined = results.map((r) => {
      // 失败 Agent 的 error 始终附带在输出中——保证部分失败信息对上层可见
      const base = r.output ?? "(无输出)";
      const errSuffix = r.error ? `\n[错误]: ${r.error}` : "";
      return `[${r.agentType ?? "unknown"}]:\n${base}${errSuffix}`;
    }).join("\n\n---\n\n");

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.length - successCount;
    let summary = `[多视角结果: ${successCount}/${results.length} 成功`;
    if (failCount > 0) summary += `, ${failCount} 失败`;
    summary += `]`;

    const finalOutput = combined + "\n\n" + summary;

    return {
      nodeId: node.id,
      agentType: agentTypes[0] as AgentType,
      // 整体成功 = 所有实际执行视角均成功；spawn 失败视角已在上面过滤（多视角自愈）
      success: results.every((r) => r.success),
      output: finalOutput,
    };
  }
}

/**
 * SimpleExecuteModel —— 简化执行范式。
 *
 * 跳过 Claim/Spawn 管线，直接调用 agent.execute()。
 * 适合测试环境和简单场景——无多实例、无池管理、无技能注入。
 *
 * 警告：不适用于生产环境的多视角节点和复杂管线。
 */
export class SimpleExecuteModel implements IExecutionModel {
  readonly name = "simple";

  async dispatchSingle(ctx: ExecutionContext): Promise<NodeResult> {
    const { node, agents, models, strategy } = ctx;
    const agentType = strategy.findMatchingAgent(node, agents);
    if (!agentType) {
      return { nodeId: node.id, success: false, error: `No agent found for ${node.type}` };
    }

    const agent = agents.get(agentType);
    if (!agent) {
      return { nodeId: node.id, success: false, error: `Agent ${agentType} not registered` };
    }

    const model = models.get(agentType) ?? "mock";
    return await agent.execute(node, model);
  }

  async dispatchMulti(_ctx: ExecutionContext): Promise<NodeResult> {
    // 简化模式不支持多视角——回退到单视角
    return await this.dispatchSingle(_ctx);
  }
}


// ══════════════════════════════════════════════
// IModelRouter —— 具体实现
// ══════════════════════════════════════════════

/**
 * FixedModelRouter —— 始终返回 Agent 注册时的默认模型。
 *
 * 默认行为，向后完全兼容：不提供 modelRouter 时等价于此。
 */
