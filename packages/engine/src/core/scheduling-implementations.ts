/**
 * 调度三抽象——具体实现。
 *
 * 提供 IScheduleStrategy / ILoopDriver / IExecutionModel 的默认实现和实验性变体。
 *
 * @module scheduling-implementations
 */

import { AgentStatus, PipelineEventType, PipelinePriority, type Agent, type AgentType, type NodeResult, type PipelineHandler, type TaskNode } from "@cortex/shared";
import type {
  IScheduleStrategy,
  ILoopDriver,
  IExecutionModel,
  LoopContext,
  LoopResult,
  ExecutionContext,
} from "./scheduling-types.js";
import { topologicalSort } from "./topological-sort.js";
import { findMatchingAgent, findAllMatchingAgents } from "./agent-matcher.js";
import { isTestEnv } from "../test-env.js";
import { ClaimStep } from "./dispatch-steps/claim-step.js";
import { SpawnStep } from "./dispatch-steps/spawn-step.js";
import { ExecuteStep } from "./dispatch-steps/execute-step.js";
import { CleanupStep } from "./dispatch-steps/cleanup-step.js";
import { BoundaryGuardStep } from "./dispatch-steps/boundary-guard-step.js";
import type { DispatchCtx, IDispatchStep } from "./dispatch-steps/types.js";

// ══════════════════════════════════════════════
// IScheduleStrategy 实现
// ══════════════════════════════════════════════

/**
 * TagMatchingStrategy —— 默认标签匹配策略。
 *
 * 行为与现有 Scheduler 完全一致：
 * 1. 先按 node.type 精确匹配 AgentType
 * 2. 回退按 tags 打分匹配（AGENT_TAGS）
 * 3. 平局按匹配密度打破
 */
export class TagMatchingStrategy implements IScheduleStrategy {
  readonly name = "tag-matching";

  findMatchingAgent(node: TaskNode, agents: Map<string, Agent>): string | null {
    return findMatchingAgent(agents, node);
  }

  findAllMatchingAgents(node: TaskNode, agents: Map<string, Agent>): string[] {
    return findAllMatchingAgents(agents, node);
  }
}

/**
 * RoundRobinStrategy —— 轮转调度策略。
 *
 * 所有可用的 Agent 按注册顺序轮转分配节点，忽略标签匹配。
 * 适合负载均衡场景——所有 Agent 均匀分担工作量。
 *
 * 局限：node.type 与 AgentType 不匹配时，Agent 可能无法处理。
 *       建议仅在同构 Agent 池（如多个 CodeAgent）中使用。
 */
export class RoundRobinStrategy implements IScheduleStrategy {
  readonly name = "round-robin";
  private _rrIndex = 0;

  private _availableAgents(agents: Map<string, Agent>): string[] {
    return [...agents.entries()]
      .filter(([, a]) => a.status === AgentStatus.Awake || a.status === AgentStatus.Active)
      .map(([type]) => type);
  }

  findMatchingAgent(node: TaskNode, agents: Map<string, Agent>): string | null {
    // 优先精确匹配
    const exact = findMatchingAgent(agents, node);
    if (exact) return exact;

    // 回退：轮转
    const available = this._availableAgents(agents);
    if (available.length === 0) return null;
    const chosen = available[this._rrIndex % available.length];
    this._rrIndex++;
    return chosen;
  }

  findAllMatchingAgents(node: TaskNode, agents: Map<string, Agent>): string[] {
    const tagMatch = findAllMatchingAgents(agents, node);
    if (tagMatch.length > 0) return tagMatch;
    return this._availableAgents(agents);
  }
}

/**
 * PriorityFirstStrategy —— 优先级优先策略。
 *
 * 对标签匹配策略的增强：匹配分数相同时，优先选择当前空闲（无 claimed 节点）的 Agent。
 * 适合混合负载场景——避免热点 Agent 过载。
 *
 * 其余行为与 TagMatchingStrategy 一致。
 */
export class PriorityFirstStrategy implements IScheduleStrategy {
  readonly name = "priority-first";

  findMatchingAgent(node: TaskNode, agents: Map<string, Agent>): string | null {
    return findMatchingAgent(agents, node);
  }

  findAllMatchingAgents(node: TaskNode, agents: Map<string, Agent>): string[] {
    // 扩大匹配范围：包含所有可用 Agent 而不只是标签匹配
    const tagMatch = findAllMatchingAgents(agents, node);
    const idle = [...agents.keys()].filter((t) => {
      if (tagMatch.includes(t)) return true;
      const a = agents.get(t);
      return a?.status === AgentStatus.Awake;
    });
    return idle.length > 0 ? idle : tagMatch;
  }
}

// ══════════════════════════════════════════════
// ILoopDriver 实现
// ══════════════════════════════════════════════

/**
 * TopologicalLayeredDriver —— 默认拓扑分层驱动。
 *
 * 行为与现有 Scheduler.executeAll() 完全一致：
 * 1. while 循环：只要还有 pending 节点就继续
 * 2. 拓扑排序 → 分层
 * 3. 逐层并行执行（Promise.allSettled）
 * 4. 处理重规划队列（replanManager）
 * 5. 全局超时保护
 */
export class TopologicalLayeredDriver implements ILoopDriver {
  readonly name = "topological-layered";

  async run(ctx: LoopContext): Promise<LoopResult> {
    const {
      board, pool, observer, agents, models,
      replanManager, config, strategy, executionModel,
    } = ctx;

    const startTime = Date.now();
    const allResults: NodeResult[] = [];
    let completed = 0;
    let failed = 0;
    let round = 0;
    let replanFlight: Promise<void> | null = null;
    const deadline = startTime + config.executeAllTimeoutMs;

    // ─── 边界违规事件监听：Agent 越界写文件 → 入队 replanManager → MetaAgent 重规划 ───
    const boundaryHandler: PipelineHandler = (event) => {
      if (event.type === PipelineEventType.AgentBoundaryViolation) {
        const payload = event.payload as { nodeId: string; reason: string };
        const node = board.getNode(payload.nodeId);
        if (node) {
          replanManager.enqueue(node, payload.reason, "boundary_violation");
        }
      }
    };
    observer.on(PipelinePriority.HIGH, boundaryHandler);

    while (true) {
      if (Date.now() >= deadline) {
        const remaining = board.getPendingNodes();
        for (const n of remaining) {
          allResults.push({ nodeId: n.id, success: false, error: `Scheduler global timeout (round ${round})` });
          try { board.failNode(n.id); } catch { /* best-effort */ }
          failed++;
        }
        observer.emit({
          type: PipelineEventType.SchedulerLoopCrashed,
          priority: PipelinePriority.CRITICAL,
          payload: { round, error: "ExecuteAll timeout", pendingAtCrash: remaining.length, hint: `全局超时 ${config.executeAllTimeoutMs}ms，${remaining.length} 个节点标记为失败` },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
        break;
      }

      try {
        round++;
        const pendingNodes = board.getPendingNodes();

        if (pendingNodes.length === 0) {
          if (replanFlight) { await replanFlight; replanFlight = null; }
          if (board.getPendingNodes().length > 0) continue;
          if (replanManager.hasPending) { replanFlight = replanManager.tryFireReplan(); continue; }
          break;
        }

        const layers = topologicalSort(pendingNodes, observer);

        if (layers.length === 0 && pendingNodes.length > 0) {
          observer.emit({
            type: PipelineEventType.SchedulerInvariantViolation,
            priority: PipelinePriority.CRITICAL,
            payload: { nodeId: pendingNodes[0].id, message: `Circular dependency detected among ${pendingNodes.length} pending nodes` },
            timestamp: Date.now(),
            notificationType: "WARNING",
          });
          for (const n of pendingNodes) {
            try { board.failNode(n.id); } catch { /* best-effort */ }
            allResults.push({ nodeId: n.id, success: false, error: "Circular dependency" });
            failed++;
          }
          continue;
        }

        for (let li = 0; li < layers.length; li++) {
          const layer = layers[li];
          observer.emit({
            type: PipelineEventType.SchedulerLayerStart,
            priority: PipelinePriority.HIGH,
            payload: { layer: li, nodes: layer.length, round },
            timestamp: Date.now(),
            notificationType: "FYI",
          });

          const layerPromises = layer.map((nodeId) => {
            const node = board.getNode(nodeId);
            if (!node) return Promise.resolve<NodeResult>({ nodeId, success: false, error: "Node not found" });

            observer.emit({
              type: PipelineEventType.NodeStart,
              priority: PipelinePriority.HIGH,
              payload: { nodeId, type: node.type },
              timestamp: Date.now(),
              notificationType: "FYI",
            });

            const execCtx: ExecutionContext = {
              node, agents, models, board, pool, observer,
              strategy, isTestEnv: isTestEnv(),
            };

            const dispatchPromise = node.needsMultiPerspective
              ? executionModel.dispatchMulti(execCtx)
              : executionModel.dispatchSingle(execCtx);

            return dispatchPromise.then((result) => {
              if (!result.success) {
                const reason = result.output ?? result.error ?? "unknown";
                replanManager.enqueue(node, reason);

                observer.emit({
                  type: PipelineEventType.NodeFailed,
                  priority: PipelinePriority.CRITICAL,
                  payload: { nodeId, error: result.error ?? "unknown" },
                  timestamp: Date.now(),
                  notificationType: "WARNING",
                });
              }
              return result;
            }).catch((e) => {
              try { board.failNode(nodeId); } catch { /* best-effort */ }
              return { nodeId, success: false, error: `Promise rejected: ${String(e).slice(0, 200)}` } as NodeResult;
            });
          });

          const settled = await Promise.allSettled(layerPromises);
          for (const r of settled) {
            if (r.status === "fulfilled") {
              allResults.push(r.value);
              if (r.value.success) completed++;
              else failed++;
            }
          }
        }

        if (replanManager.hasPending && !replanFlight) {
          replanFlight = replanManager.tryFireReplan();
        }
      } catch (loopErr) {
        const snappedPending = board.getPendingNodes();
        observer.emit({
          type: PipelineEventType.SchedulerLoopCrashed,
          priority: PipelinePriority.CRITICAL,
          payload: { round, error: String(loopErr).slice(0, 300), pendingAtCrash: snappedPending.length },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
        for (const n of snappedPending) {
          try { board.failNode(n.id); } catch { /* best-effort */ }
          allResults.push({ nodeId: n.id, success: false, error: `Scheduler loop crashed at round ${round}` });
          failed++;
        }
        replanManager.reset();
        break;
      }
    }

    if (replanFlight) await replanFlight;
    replanManager.resolveChains(allResults);

    // 退订边界违规监听
    observer.off(PipelinePriority.HIGH, boundaryHandler);

    observer.emit({
      type: PipelineEventType.SchedulerDone,
      priority: PipelinePriority.CRITICAL,
      payload: { total: allResults.length, completed, failed, durationMs: Date.now() - startTime, rounds: round },
      timestamp: Date.now(),
      notificationType: "FYI",
    });

    return { completed, failed, results: allResults };
  }
}

/**
 * SequentialDriver —— 严格顺序驱动。
 *
 * 不进行拓扑排序，不并行。按节点入板顺序逐个执行。
 * 每个节点执行完才处理下一个。适合调试和简单依赖场景。
 *
 * 注意：不处理节点间依赖——如果 B 依赖 A 的输出，需确保 A 在 B 之前入板。
 */
export class SequentialDriver implements ILoopDriver {
  readonly name = "sequential";

  async run(ctx: LoopContext): Promise<LoopResult> {
    const { board, observer, strategy, executionModel, agents, models, pool, replanManager } = ctx;
    const allResults: NodeResult[] = [];
    let completed = 0;
    let failed = 0;

    const startTime = Date.now();
    let replanFlight: Promise<void> | null = null;

    while (true) {
      const pendingNodes = board.getPendingNodes();
      if (pendingNodes.length === 0) {
        if (replanFlight) { await replanFlight; replanFlight = null; }
        if (board.getPendingNodes().length > 0) continue;
        if (replanManager.hasPending) { replanFlight = replanManager.tryFireReplan(); continue; }
        break;
      }

      // 顺序执行每个节点
      for (const node of pendingNodes) {
        observer.emit({
          type: PipelineEventType.NodeStart,
          priority: PipelinePriority.HIGH,
          payload: { nodeId: node.id, type: node.type },
          timestamp: Date.now(),
          notificationType: "FYI",
        });

        const execCtx: ExecutionContext = {
          node, agents, models, board, pool, observer,
          strategy, isTestEnv: isTestEnv(),
        };

        try {
          const result = node.needsMultiPerspective
            ? await executionModel.dispatchMulti(execCtx)
            : await executionModel.dispatchSingle(execCtx);

          allResults.push(result);
          if (result.success) completed++;
          else {
            failed++;
            const reason = result.output ?? result.error ?? "unknown";
            replanManager.enqueue(node, reason);
            observer.emit({
              type: PipelineEventType.NodeFailed,
              priority: PipelinePriority.CRITICAL,
              payload: { nodeId: node.id, error: result.error ?? "unknown" },
              timestamp: Date.now(),
              notificationType: "WARNING",
            });
          }
        } catch (e) {
          try { board.failNode(node.id); } catch { /* best-effort */ }
          allResults.push({ nodeId: node.id, success: false, error: String(e).slice(0, 200) });
          failed++;
        }
      }

      if (replanManager.hasPending && !replanFlight) {
        replanFlight = replanManager.tryFireReplan();
      }
    }

    if (replanFlight) await replanFlight;
    replanManager.resolveChains(allResults);

    observer.emit({
      type: PipelineEventType.SchedulerDone,
      priority: PipelinePriority.CRITICAL,
      payload: { total: allResults.length, completed, failed, durationMs: Date.now() - startTime, rounds: 1 },
      timestamp: Date.now(),
      notificationType: "FYI",
    });

    return { completed, failed, results: allResults };
  }
}

/**
 * WaveDriver —— 波浪式驱动。
 *
 * 按标签语义将节点分组为波浪：
 *   Wave 1 (design)：    analysis, inspector, doc_govern 等设计/分析类节点
 *   Wave 2 (implement)：  code, api, data 等实现类节点
 *   Wave 3 (review)：     review, fix 等审查/修复类节点
 *   Wave 4 (verify)：     ops 等验证类节点
 *
 * 每波内节点按拓扑排序并行执行，波间串行——确保设计→实现→审查→验证的因果关系。
 * 未分类节点放入最后一波（兜底）。
 */
export class WaveDriver implements ILoopDriver {
  readonly name = "wave";

  /** 波浪定义：标签 → 波浪序号（越小越先执行）
   *
   * 注意：标签顺序即优先级——同一节点多个标签命中时，先匹配到的生效。
   * 因此"review"排在"audit"之前，确保 review 节点不被 audit 误判到设计波。
   */
  private static readonly WAVE_DEFINITIONS: Array<{ wave: number; tags: string[] }> = [
    { wave: 0, tags: ["design", "architecture", "research", "analysis", "inspect"] },
    { wave: 1, tags: ["code", "implement", "api", "data", "schema", "build"] },
    { wave: 2, tags: ["review", "fix", "refactor", "audit", "doc", "constitution"] },
    { wave: 3, tags: ["verify", "validate", "deploy", "ops", "script", "test"] },
  ];

  private _classifyWave(node: TaskNode): number {
    const tags = new Set(node.tags.map((t) => t.toLowerCase()));
    for (const def of WaveDriver.WAVE_DEFINITIONS) {
      for (const tag of def.tags) {
        if (tags.has(tag)) return def.wave;
      }
    }
    return 4; // 未分类 → 最后一波
  }

  async run(ctx: LoopContext): Promise<LoopResult> {
    const { board, observer, strategy, executionModel, agents, models, pool, replanManager, config } = ctx;
    const allResults: NodeResult[] = [];
    let completed = 0;
    let failed = 0;
    let round = 0;
    let replanFlight: Promise<void> | null = null;
    const deadline = Date.now() + config.executeAllTimeoutMs;
    const startTime = Date.now();

    while (true) {
      if (Date.now() >= deadline) {
        const remaining = board.getPendingNodes();
        for (const n of remaining) {
          allResults.push({ nodeId: n.id, success: false, error: "Timeout" });
          try { board.failNode(n.id); } catch { /* best-effort */ }
          failed++;
        }
        break;
      }

      round++;
      const pendingNodes = board.getPendingNodes();
      if (pendingNodes.length === 0) {
        if (replanFlight) { await replanFlight; replanFlight = null; }
        if (board.getPendingNodes().length > 0) continue;
        if (replanManager.hasPending) { replanFlight = replanManager.tryFireReplan(); continue; }
        break;
      }

      // 按波浪分组
      const waves = new Map<number, TaskNode[]>();
      for (const n of pendingNodes) {
        const w = this._classifyWave(n);
        if (!waves.has(w)) waves.set(w, []);
        const waveBucket = waves.get(w);
        if (waveBucket) waveBucket.push(n);
      }

      const sortedWaves = [...waves.keys()].sort((a, b) => a - b);

      for (const waveIdx of sortedWaves) {
        const waveBucket = waves.get(waveIdx);
        if (!waveBucket) continue;
        let waveNodes = waveBucket;

        // 跨波父依赖过滤：父节点在其它波且仍未完成 → 本轮跳过，等父节点先跑
        const pendingIds = new Set(pendingNodes.map((n) => n.id));
        const filtered = waveNodes.filter((n) => {
          if (!n.parentId) return true;
          if (!pendingIds.has(n.parentId)) return true; // 父节点已完成
          const parentNode = board.getNode(n.parentId);
          if (!parentNode) return true;                  // 父节点不存在（dangling）
          const parentWave = this._classifyWave(parentNode);
          return parentWave === waveIdx;                 // 仅同波父节点才可并行
        });
        const skipped = waveNodes.length - filtered.length;
        if (skipped > 0) {
          observer.emit({
            type: PipelineEventType.SchedulerNonstandardType,
            priority: PipelinePriority.NORMAL,
            payload: { message: `WaveDriver wave ${waveIdx}: ${skipped} node(s) deferred (parent in different wave)` },
            timestamp: Date.now(),
            notificationType: "FYI",
          });
        }
        waveNodes = filtered;
        if (waveNodes.length === 0) continue;

        observer.emit({
          type: PipelineEventType.SchedulerLayerStart,
          priority: PipelinePriority.HIGH,
          payload: { layer: waveIdx, nodes: waveNodes.length, round, wave: waveIdx },
          timestamp: Date.now(),
          notificationType: "FYI",
        });

        // 波内拓扑排序 + 并行
        const layers = topologicalSort(waveNodes, observer);
        for (const layer of layers) {
          const layerPromises = layer.map((nodeId) => {
            const node = board.getNode(nodeId);
            if (!node) return Promise.resolve<NodeResult>({ nodeId, success: false, error: "Node not found" });

            const execCtx: ExecutionContext = {
              node, agents, models, board, pool, observer,
              strategy, isTestEnv: isTestEnv(),
            };

            const p = node.needsMultiPerspective
              ? executionModel.dispatchMulti(execCtx)
              : executionModel.dispatchSingle(execCtx);

            return p.then((result) => {
              if (!result.success) {
                replanManager.enqueue(node, result.output ?? result.error ?? "unknown");
              }
              return result;
            }).catch((e) =>
              ({ nodeId, success: false, error: String(e).slice(0, 200) } as NodeResult)
            );
          });

          const settled = await Promise.allSettled(layerPromises);
          for (const r of settled) {
            if (r.status === "fulfilled") {
              allResults.push(r.value);
              if (r.value.success) completed++;
              else failed++;
            }
          }
        }
      }

      if (replanManager.hasPending && !replanFlight) {
        replanFlight = replanManager.tryFireReplan();
      }
    }

    if (replanFlight) await replanFlight;
    replanManager.resolveChains(allResults);

    observer.emit({
      type: PipelineEventType.SchedulerDone,
      priority: PipelinePriority.CRITICAL,
      payload: { total: allResults.length, completed, failed, durationMs: Date.now() - startTime, rounds: round },
      timestamp: Date.now(),
      notificationType: "FYI",
    });

    return { completed, failed, results: allResults };
  }
}

// ══════════════════════════════════════════════
// IExecutionModel 实现
// ══════════════════════════════════════════════

/** 执行 IDispatchStep 管线 */
async function runDispatchPipeline(ctx: DispatchCtx, steps: IDispatchStep[]): Promise<NodeResult> {
  for (const step of steps) {
    ctx = await step.run(ctx);
    if (ctx.result && !ctx.result.success && step.name !== "Cleanup") {
      const result = ctx.result;
      const lastStep = steps[steps.length - 1];
      if (lastStep.name === "Cleanup") {
        await lastStep.run(ctx);
      }
      return result;
    }
  }
  return ctx.result ?? { nodeId: ctx.node.id, success: false, error: "Dispatch completed without result" };
}

/**
 * PipelineModel —— 默认管线执行范式。
 *
 *   单视角：Claim → Spawn → Execute → BoundaryGuard → Cleanup
 *   多视角：直接 Execute → Cleanup
 */
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
      return await runDispatchPipeline(dispatchCtx, steps);
    });

    const results = (await Promise.all(promises)).filter((r): r is NonNullable<typeof r> => r !== null);

    if (results.length === 0) {
      board.failNode(node.id);
      return { nodeId: node.id, success: false, error: "All agents failed to claim multi-perspective node" };
    }

    const combined = results.map((r) => `[${r.agentType}] ${r.output ?? r.error}`).join("\n");
    const finalNode = board.getNode(node.id);
    const isDone = finalNode?.status === "done";

    return {
      nodeId: node.id,
      agentType: agentTypes[0] as AgentType,
      success: isDone || results.every((r) => r.success),
      output: combined,
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
