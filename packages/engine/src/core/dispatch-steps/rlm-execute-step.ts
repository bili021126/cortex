import type { Agent, AgentType, TaskNode, SubTask, NodeResult, DensityAnnotated } from "@cortex/shared";
import type { DispatchCtx, IDispatchStep } from "./types.js";
import { DEFAULT_CLI_CHAT_MODEL } from "@cortex/config";
import {
  decompose,
  shouldDecompose,
  shouldExecuteDecomposition,
  MAX_RLM_DEPTH,
} from "../rlm-decompose.js";
import {
  annotateAndCompress,
  mergeContext,
  densityToStrategy,
} from "../density-compress.js";

/** RLM 同层子任务最大并行数——超过上限的子任务改为串行执行 */
const MAX_PARALLEL_SUBTASKS = 5;

/**
 * RlmExecuteStep —— RLM 递归分层执行步骤。
 *
 * 在 ExecuteStep 之上实现完整的 RLM 动态递归拆解（思考执行体系总纲 §四）：
 *
 * 1. 检测节点复杂度 → 决定是否拆解
 * 2. LLM 驱动的 decompose() → 产出 SubTask 列表
 * 3. 低信心/不可拆 → 回退直接执行（现有行为）
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
    const executeNode = node;

    // ── 判断是否需要 RLM 拆解 ──
    if (!this._shouldAttemptDecompose(executeNode)) {
      return await this._directExecute(ctx, agent, agentType, executeNode, model);
    }

    // ── 尝试拆解 ──
    const decomposeResult = await this._tryDecompose(ctx, executeNode, model);
    if (!shouldExecuteDecomposition(decomposeResult)) {
      // 拆解失败或不可拆 → 回退直接执行
      return await this._directExecute(ctx, agent, agentType, executeNode, model);
    }

    // ── 执行子任务（分层并行 + DENSITY 压缩）──
    return await this._executeSubTasks(ctx, agent, agentType, decomposeResult.subTasks, model);
  }

  // ═══════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════

  /**
   * 判断是否应尝试 RLM 拆解。
   * 已设置 isRlmSubtask 的子任务不再递归拆解（防止无限递归）。
   */
  private _shouldAttemptDecompose(node: TaskNode): boolean {
    if (node.isRlmSubtask) return false; // 已是子任务，不再拆
    if (node.preferredStrategy === "direct" || node.preferredStrategy === "react") return false;
    return shouldDecompose(node.payload, node.tags, node.preferredStrategy);
  }

  /** 尝试 LLM 拆解 */
  private async _tryDecompose(ctx: DispatchCtx, node: TaskNode, model: string) {
    if (!ctx.llmChat) {
      return { subTasks: [], confidence: 0, rationale: "未注入 LLM 调用入口" };
    }
    return await decompose(ctx.llmChat, model, node.payload);
  }

  /** 直接执行（现有行为，不回退） */
  private async _directExecute(
    ctx: DispatchCtx,
    agent: Agent,
    agentType: string,
    node: TaskNode,
    model: string,
  ): Promise<DispatchCtx> {
    let result: NodeResult;
    try {
      result = await agent.execute(node, model);
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

  /**
   * 分层并行执行子任务，层间用 DENSITY 压缩传递上下文。
   *
   * 流程：
   * 1. 按 depends_on 分层（无依赖=第0层，同层并行）
   * 2. 逐层执行，每层并行 fan-out
   * 3. 每层完成后对产出做 DENSITY 标注和压缩
   * 4. 将压缩上下文注入下一层的子任务 payload
   * 5. 任意子任务失败 → 该层后续子任务跳过（trigger 边语义）
   * 6. 合并所有产出为最终 result
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

    for (let li = 0; li < layers.length && li < MAX_RLM_DEPTH; li++) {
      const layer = layers[li];

      // 构建此层的上下文（来自之前层的压缩产出）
      const layerContext = mergeContext(allAnnotations);

      // 同层子任务分批并行执行（扇出上限 MAX_PARALLEL_SUBTASKS）
      for (let si = 0; si < layer.length; si += MAX_PARALLEL_SUBTASKS) {
        const batch = layer.slice(si, si + MAX_PARALLEL_SUBTASKS);
        const batchPromises = batch.map((st) =>
          this._executeOneSubTask(ctx, agent, agentType, st, layerContext, model),
        );
        const settled = await Promise.allSettled(batchPromises);

        // 收集产出并做 DENSITY 标注
        for (const s of settled) {
          if (s.status === "fulfilled" && s.value) {
            allAnnotations.push(s.value);
          }
          // 失败的子任务不阻塞同层其他子任务，但不产出上下文
        }
      }
    }

    // 合并所有子任务产出
    const merged = mergeContext(allAnnotations);
    return {
      ...ctx,
      result: {
        nodeId: ctx.node.id,
        agentType: agentType as AgentType,
        success: allAnnotations.length > 0,
        output: merged || "(RLM 子任务执行完成，无产出)",
      },
    };
  }

  /**
   * 执行单个子任务。
   * 构建合成 TaskNode（isRlmSubtask=true, DSA 窄注意力），
   * 调用 agent.execute()，对产出做 DENSITY 标注。
   */
  private async _executeOneSubTask(
    ctx: DispatchCtx,
    agent: Agent,
    agentType: string,
    subTask: SubTask,
    upstreamContext: string,
    model: string,
  ): Promise<DensityAnnotated | null> {
    // 构建合成子任务节点
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
      // 对产出做 DENSITY 标注和压缩（使用子任务自标注的密度级别）
      const annotated = annotateAndCompress(
        `[DENSITY: ${subTask.density}] ${output}`,
      );
      return annotated;
    } catch {
      // 子任务失败 → 返回 null，不产出上下文但不阻塞同层
      return null;
    }
  }

  /**
   * 按 depends_on 关系对子任务分层。
   * 无依赖的子任务 → 第 0 层（并行）
   * 依赖第 0 层的 → 第 1 层
   * 以此类推
   */
  private _layerSubTasks(subTasks: SubTask[]): SubTask[][] {
    if (subTasks.length === 0) return [];

    const idSet = new Set(subTasks.map((st) => st.id));
    const children = new Map<string, string[]>(); // parentId → childIds
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

    // 循环依赖检测
    if (roots.length === 0 && subTasks.length > 0) {
      // 所有子任务都有循环依赖 → 全部放入一层顺序执行
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
                // 检查所有依赖是否已在之前层中满足
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

    // 处理未入层的（循环依赖残留）
    const unlayered = subTasks.filter((st) => !seen.has(st.id));
    if (unlayered.length > 0) {
      layers.push(unlayered);
    }

    return layers;
  }
}
