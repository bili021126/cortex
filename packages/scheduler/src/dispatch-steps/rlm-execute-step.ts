import { PipelineEventType, PipelinePriority, type Agent, type AgentType, type DensityAnnotated, type NodeResult, type SubTask, type TaskNode } from "@cortex/shared";
import type { DispatchCtx, IDispatchStep } from "./types.js";
import { DEFAULT_CLI_CHAT_MODEL } from "@cortex/config";
import {
  decompose,
  shouldDecompose,
  shouldExecuteDecomposition,
  MAX_RLM_DEPTH,
} from "../core/rlm-decompose.js";
import {
  annotateAndCompress,
  mergeContext,
  densityToStrategy,
} from "../core/density-compress.js";

/** RLM 同层子任务最大并行数——超过上限的子任务改为串行执行 */
const MAX_PARALLEL_SUBTASKS = 5;

/**
 * RlmExecuteStep —— RLM 递归分层执行步骤。
 *
 * 在 ExecuteStep 之上实现完整的 RLM 动态递归拆解：
 *
 * 1. 检测节点复杂度 → 决定是否拆解
 * 2. LLM 驱动的 decompose() → 产出 SubTask 列表
 * 3. 低信心/不可拆 → 回退直接执行
 * 4. 可拆 → 按 depends_on 分层并行执行子任务
 * 5. DENSITY 压缩 → 层间上下文传递
 * 6. maxDepth=3 自限
 * 7. 失败逐级冒泡
 *
 * 子任务不走 AgentPool 完整生命周期——直接调 agent.execute(subTaskNode, model)。
 *
 * @since RLM 递归拆解
 */
export class RlmExecuteStep implements IDispatchStep {
  readonly name = "RlmExecute";

  async run(ctx: DispatchCtx): Promise<DispatchCtx> {
    const { agent, agentType, node, models } = ctx;

    if (!agent || !agentType) {
      return {
        ...ctx,
        result: {
          nodeId: node.id,
          success: false,
          error: "RlmExecuteStep: agent or agentType not set",
        },
      };
    }

    const model = ctx.model ?? models.get(agentType) ?? DEFAULT_CLI_CHAT_MODEL;
    // 有模型路由器时，根据任务语义动态选择模型（否则用 Agent 注册时的默认模型）
    const routedModel = ctx.modelRouter
      ? await ctx.modelRouter.route(node, agentType, model)
      : model;
    const executeNode = node;

    // ── 判断是否需要 RLM 拆解 ──
    const isRlmSubtask = executeNode.isRlmSubtask === true;
    const prefStrategy = executeNode.preferredStrategy;
    if (!this._shouldAttemptDecompose(executeNode)) {
      console.error(`[TRACE dispatch] RlmExecuteStep: agentType=${agentType} nodeId=${node.id} decision=directExecute reason=${isRlmSubtask ? 'isRlmSubtask' : (prefStrategy ? `preferredStrategy=${prefStrategy}` : 'shouldDecompose=false')}`);
      return await this._directExecute(ctx, agent, agentType, executeNode, routedModel);
    }

    // ── 尝试拆解 ──
    const decomposeResult = await this._tryDecompose(ctx, executeNode, routedModel);
    if (!shouldExecuteDecomposition(decomposeResult)) {
      return await this._directExecute(ctx, agent, agentType, executeNode, routedModel);
    }

    // ── 发射拆解事件 ──
    ctx.observer.emit({
      type: PipelineEventType.RlmDecompose,
      priority: PipelinePriority.HIGH,
      payload: {
        nodeId: executeNode.id,
        subTaskCount: decomposeResult.subTasks.length,
        depth: 1,
        confidence: decomposeResult.confidence,
        rationale: decomposeResult.rationale,
      },
      timestamp: Date.now(),
      notificationType: "FYI",
    });

    // ── 执行子任务（分层并行 + DENSITY 压缩）──
    return await this._executeSubTasks(ctx, agent, agentType, decomposeResult.subTasks, routedModel);
  }

  // ═══════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════

  /**
   * 判断是否应尝试 RLM 拆解。
   * 已设置 isRlmSubtask 的子任务不再递归拆解（防止无限递归）。
   */
  private _shouldAttemptDecompose(node: TaskNode): boolean {
    if (node.isRlmSubtask) return false;
    if (node.preferredStrategy === "direct" || node.preferredStrategy === "react") return false;
    return shouldDecompose(node.payload, node.tags, node.preferredStrategy);
  }

  /** 尝试 LLM 拆解 */
  private async _tryDecompose(ctx: DispatchCtx, node: TaskNode, model: string) {
    if (!ctx.llmChat) {
      return { subTasks: [], confidence: 0, rationale: "未注入 LLM 调用入口" };
    }
    // R12-D2：RLM 拆解 LLM 调用结果回传（连续失败触发熔断降级）
    const t0 = Date.now();
    try {
      const result = await decompose(ctx.llmChat, model, node.payload);
      ctx.modelRouter?.reportSuccess?.(model, Date.now() - t0);
      return result;
    } catch (e) {
      ctx.modelRouter?.reportFailure?.(model);
      throw e;
    }
  }

  /** 直接执行 */
  private async _directExecute(
    ctx: DispatchCtx,
    agent: Agent,
    agentType: string,
    node: TaskNode,
    model: string,
  ): Promise<DispatchCtx> {
    let result: NodeResult;
    // R12-D2：模型调用结果回传（连续失败触发熔断降级）
    const router = ctx.modelRouter;
    const t0 = Date.now();
    try {
      result = await agent.execute(node, model);
      router?.reportSuccess?.(model, Date.now() - t0);
    } catch (e) {
      result = {
        nodeId: node.id,
        agentType: agentType as AgentType,
        success: false,
        error: String(e),
      };
      router?.reportFailure?.(model);
    }
    return { ...ctx, result };
  }

  /**
   * 分层并行执行子任务，层间用 DENSITY 压缩传递上下文。
   */
  private async _executeSubTasks(
    ctx: DispatchCtx,
    agent: Agent,
    agentType: string,
    subTasks: SubTask[],
    model: string,
  ): Promise<DispatchCtx> {
    const layers = this._layerSubTasks(subTasks);
    const allAnnotations: DensityAnnotated[] = [];
    // P2 fix: 实际尝试执行的子任务数——层截断时分母不等于 subTasks.length，防止误判失败
    let attemptedCount = 0;

    // P2 fix: 层截断告警——超过 MAX_RLM_DEPTH 的层被丢弃时 emit 告警
    if (layers.length > MAX_RLM_DEPTH) {
      try {
        ctx.observer.emit({
          type: PipelineEventType.SchedulerReplanLimit,
          priority: PipelinePriority.NORMAL,
          payload: { totalReplans: layers.length, maxReplans: MAX_RLM_DEPTH, deferred: layers.length - MAX_RLM_DEPTH },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } catch { /* 告警自身异常不传播 */ }
    }

    for (let li = 0; li < layers.length && li < MAX_RLM_DEPTH; li++) {
      const layer = layers[li];
      if (!layer) continue;
      attemptedCount += layer.length;
      const layerContext = mergeContext(allAnnotations);

      for (let si = 0; si < layer.length; si += MAX_PARALLEL_SUBTASKS) {
        const batch = layer.slice(si, si + MAX_PARALLEL_SUBTASKS);
        const batchPromises = batch.map((st) =>
          this._executeOneSubTask(ctx, agent, agentType, st, layerContext, model),
        );
        const settled = await Promise.allSettled(batchPromises);

        for (const s of settled) {
          if (s.status === "fulfilled" && s.value) {
            allAnnotations.push(s.value);
          }
        }
      }
    }

    const merged = mergeContext(allAnnotations);
    return {
      ...ctx,
      result: {
        nodeId: ctx.node.id,
        agentType: agentType as AgentType,
        // 修正 C-06：1/10 子任务产出即标记成功 → 成功率 ≥ 50% 才算成功
        // P2 fix: 分母改为实际尝试执行的子任务数——层截断不再把未尝试的子任务计入分母
        success: allAnnotations.length > 0 && attemptedCount > 0
          ? (allAnnotations.length / attemptedCount) >= 0.5
          : allAnnotations.length > 0,
        output: merged || "(RLM 子任务执行完成，无产出)",
      },
    };
  }

  /**
   * 执行单个子任务。
   */
  private async _executeOneSubTask(
    ctx: DispatchCtx,
    agent: Agent,
    agentType: string,
    subTask: SubTask,
    upstreamContext: string,
    model: string,
  ): Promise<DensityAnnotated | null> {
    const subNode: TaskNode = {
      id: `${ctx.node.id}-rlm-${subTask.id}`,
      parentId: ctx.node.id,
      type: ctx.node.type,
      tags: [...ctx.node.tags],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: upstreamContext
        ? `[上游上下文]\n${upstreamContext}\n\n[当前任务]\n${subTask.description}`
        : subTask.description,
      results: [],
      createdAt: Date.now(),
      isRlmSubtask: true,
      reasoningEffort: "high",
      preferredStrategy: densityToStrategy(subTask.density),
    };

    try {
      const result = await agent.execute(subNode, model);
      const output = result.output ?? result.error ?? "";
      const rawText = `[DENSITY: ${subTask.density}] ${output}`;
      const annotated = annotateAndCompress(rawText);

      // ── 发射上下文压缩事件 ──
      if (annotated.raw.length !== annotated.compressed.length) {
        ctx.observer.emit({
          type: PipelineEventType.RlmContextCompress,
          priority: PipelinePriority.NORMAL,
          payload: {
            nodeId: ctx.node.id,
            density: subTask.density,
            originalLength: annotated.raw.length,
            compressedLength: annotated.compressed.length,
          },
          timestamp: Date.now(),
          notificationType: "FYI",
        });
      }

      return annotated;
    } catch {
      console.error(`[scheduler] rlm.subtask_failed nodeId=${ctx.node.id}`);
      return null;
    }
  }

  /**
   * 按 depends_on 关系对子任务分层。
   */
  private _layerSubTasks(subTasks: SubTask[]): SubTask[][] {
    if (subTasks.length === 0) return [];

    const idSet = new Set(subTasks.map((st) => st.id));
    const children = new Map<string, string[]>();
    const roots: SubTask[] = [];

    for (const st of subTasks) {
      const unresolvedDeps = st.dependsOn.filter((d) => idSet.has(d));
      if (unresolvedDeps.length === 0) {
        roots.push(st);
      } else {
        for (const dep of unresolvedDeps) {
          const list = children.get(dep) ?? [];
          list.push(st.id);
          children.set(dep, list);
        }
      }
    }

    if (roots.length === 0 && subTasks.length > 0) {
      return [subTasks];
    }

    const subTaskMap = new Map(subTasks.map((st) => [st.id, st]));
    const layers: SubTask[][] = [];
    let current = roots;
    const seen = new Set<string>(roots.map((r) => r.id));

    while (current.length > 0) {
      layers.push(current);
      const next: SubTask[] = [];
      for (const st of current) {
        const kids = children.get(st.id);
        if (kids) {
          for (const kidId of kids) {
            if (!seen.has(kidId)) {
              const kid = subTaskMap.get(kidId);
              if (kid) {
                const allDepsMet = kid.dependsOn
                  .filter((d) => idSet.has(d))
                  .every((d) => seen.has(d));
                if (allDepsMet) {
                  seen.add(kidId);
                  next.push(kid);
                }
              }
            }
          }
        }
      }
      current = next;
    }

    const unlayered = subTasks.filter((st) => !seen.has(st.id));
    if (unlayered.length > 0) {
      layers.push(unlayered);
    }

    return layers;
  }
}
