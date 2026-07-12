/**
 * 调度四抽象——具体实现。
 *
 * 提供 IScheduleStrategy / ILoopDriver / IExecutionModel / IModelRouter 的默认实现和实验性变体。
 *
 * @module scheduling-implementations
 * @since v3.x — 从 @cortex/engine 完整迁入 @cortex/scheduler
 */

import { AgentStatus, PipelineEventType, PipelinePriority, type Agent, type AgentType, type NodeResult, type PipelineHandler, type TaskNode } from "@cortex/shared";
import type {
  IScheduleStrategy,
  ILoopDriver,
  IExecutionModel,
  IModelRouter,
  ModelTier,
  LoopContext,
  LoopResult,
  ExecutionContext,
} from "./scheduling-types.js";
import type { TimeoutAction } from "./agent-tracker.js";
import { topologicalSort } from "./topological-sort.js";
import { findMatchingAgent, findAllMatchingAgents } from "./agent-matcher.js";
import { ClaimStep } from "../dispatch-steps/claim-step.js";
import { SpawnStep } from "../dispatch-steps/spawn-step.js";
import { ExecuteStep } from "../dispatch-steps/execute-step.js";
import { VALID_TIERS } from "@cortex/config";
import { CleanupStep } from "../dispatch-steps/cleanup-step.js";
import { BoundaryGuardStep } from "../dispatch-steps/boundary-guard-step.js";
import type { DispatchCtx, IDispatchStep } from "../dispatch-steps/types.js";
import { isTestEnv } from "../utils/internal.js";
import { computeCompensation } from "./compensation.js";

// ══════════════════════════════════════════════
// IScheduleStrategy 实现
// ══════════════════════════════════════════════

/**
 * AgentTracker 超时动作分发——供各 driver 的循环中调用。
 * 处理 checkTimeouts() 返回的 TimeoutAction[]：
 *   warn  → emit Exec:NodeDelayed (wait)
 *   ping  → pool.ping(agentId) + emit Exec:NodeDelayed (extend)
 *   kill  → board.failNode + emit NodeFailed
 */
function _handleTimeoutActions(actions: TimeoutAction[], ctx: LoopContext): void {
  for (const a of actions) {
    switch (a.type) {
      case 'warn':
        ctx.observer.emit({
          type: PipelineEventType.ExecNodeDelayed,
          priority: PipelinePriority.NORMAL,
          payload: { nodeId: a.nodeId, agentId: a.agentId, elapsed: a.elapsed, action: 'wait', level: 'warn' },
          timestamp: Date.now(),
          notificationType: "FYI",
        });
        break;

      case 'ping':
        // 异步探测——不 blocking
        ctx.pool.ping(a.agentId).catch(() => {});
        ctx.observer.emit({
          type: PipelineEventType.ExecNodeDelayed,
          priority: PipelinePriority.NORMAL,
          payload: { nodeId: a.nodeId, agentId: a.agentId, elapsed: a.elapsed, action: 'extend', level: 'ping' },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
        break;

      case 'kill':
        try { ctx.board.failNode(a.nodeId); } catch (e) {
          if (ctx.observer) {
            try { ctx.observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "agent-kill-best-effort", detail: String(e) }, timestamp: Date.now(), notificationType: "WARNING" }); } catch { console.error(`[scheduler] best-effort failed: ${e}`); }
          }
        }
        ctx.observer.emit({
          type: PipelineEventType.NodeFailed,
          priority: PipelinePriority.CRITICAL,
          payload: { nodeId: a.nodeId, error: `Agent heartbeat timeout after ${a.elapsed}ms` },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
        break;
    }
  }
}

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
    if (available.length === 0) return null;
    const chosen = available[this._rrIndex % available.length]!;
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

  /** 增量拓扑缓存——pending 节点 ID 集合不变时复用上次排序结果 */
  private _lastPendingIds: string | null = null;
  private _lastLayers: string[][] | null = null;

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
          try { board.failNode(n.id); } catch { console.error(`[scheduler] global-timeout failNode failed for ${n.id}`); }
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
        // ── 遥测：AgentPool 空闲率 ──
        const poolStats = ctx.pool.getPoolStats();
        console.error(`[telemetry] agent_pool.idle_rate total=${poolStats.total} idle=${poolStats.idle} busy=${poolStats.busy} idleRate=${poolStats.idleRate}`);
        const pendingNodes = board.getPendingNodes();

        if (pendingNodes.length === 0) {
          if (replanFlight) { await replanFlight; replanFlight = null; }
          if (board.getPendingNodes().length > 0) continue;
          if (replanManager.hasPending) { replanFlight = replanManager.tryFireReplan(); continue; }
          break;
        }

        let layers: string[][];
        const pendingIds = pendingNodes.map(n => n.id).sort().join(",");
        if (pendingIds === this._lastPendingIds && this._lastLayers !== null) {
          layers = this._lastLayers;
        } else {
          layers = topologicalSort(pendingNodes, observer);
          this._lastPendingIds = pendingIds;
          this._lastLayers = layers;
        }

        if (layers.length === 0 && pendingNodes.length > 0) {
          observer.emit({
            type: PipelineEventType.SchedulerInvariantViolation,
            priority: PipelinePriority.CRITICAL,
            payload: { nodeId: pendingNodes[0]!.id, message: `Circular dependency detected among ${pendingNodes.length} pending nodes` },
            timestamp: Date.now(),
            notificationType: "WARNING",
          });
          for (const n of pendingNodes) {
            try { board.failNode(n.id); } catch (e) {
              if (observer) {
                try { observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "circular-dep-fail-best-effort", detail: String(e) }, timestamp: Date.now(), notificationType: "WARNING" }); } catch { console.error(`[scheduler] circular-dep observer.emit failed: ${String(e)}`); }
              }
            }
            allResults.push({ nodeId: n.id, success: false, error: "Circular dependency" });
            failed++;
          }
          continue;
        }

        for (let li = 0; li < layers.length; li++) {
          const layer = layers[li]!;
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

            // dispatchNode 优先——经典 Scheduler 已自行处理 NodeStart/NodeFailed/replan
            if (ctx.dispatchNode) {
              const waitTime = Date.now() - node.createdAt;
              if (waitTime > 500) {
                console.error(`[telemetry] scheduler.node_wait_time_ms value=${waitTime} nodeType=${node.type}`);
              }
              return ctx.dispatchNode(node).catch((e) => {
                try { board.failNode(nodeId); } catch (fe) {
                  if (observer) {
                    try { observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "dispatch-node-reject-fail-best-effort", detail: String(fe) }, timestamp: Date.now(), notificationType: "WARNING" }); } catch { console.error(`[scheduler] dispatch-node-reject observer.emit failed: ${String(fe)}`); }
                  }
                }
                return { nodeId, success: false, error: `Promise rejected: ${String(e).slice(0, 200)}` } as NodeResult;
              });
            }

            observer.emit({
              type: PipelineEventType.NodeStart,
              priority: PipelinePriority.HIGH,
              payload: { nodeId, type: node.type },
              timestamp: Date.now(),
              notificationType: "FYI",
            });

            const waitTime = Date.now() - node.createdAt;
            if (waitTime > 500) {
              console.error(`[telemetry] scheduler.node_wait_time_ms value=${waitTime} nodeType=${node.type}`);
            }

            const execCtx: ExecutionContext = {
              node, agents, models, board, pool, observer,
              strategy, isTestEnv: isTestEnv(),
            };

            const dispatchPromise = node.needsMultiPerspective
              ? executionModel.dispatchMulti(execCtx)
              : executionModel.dispatchSingle(execCtx);

            // 单个节点超时兜底——防止 dispatch hang 住拖死 Promise.allSettled
            const NODE_DISPATCH_TIMEOUT_MS = Math.min(config.reactLoopTimeoutMs, 120_000);
            const timeoutPromise = new Promise<NodeResult>((resolve) => {
              setTimeout(() => {
                try { board.failNode(nodeId); } catch (fe) {
                  if (observer) {
                    try { observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "dispatch-timeout-fail-best-effort", detail: String(fe) }, timestamp: Date.now(), notificationType: "WARNING" }); } catch { console.error(`[scheduler] dispatch-timeout observer.emit failed: ${String(fe)}`); }
                  }
                }
                observer.emit({
                  type: PipelineEventType.NodeFailed,
                  priority: PipelinePriority.CRITICAL,
                  payload: { nodeId, error: `Node dispatch timeout after ${NODE_DISPATCH_TIMEOUT_MS}ms` },
                  timestamp: Date.now(),
                  notificationType: "WARNING",
                });
                resolve({ nodeId, success: false, error: `Node dispatch timeout` });
              }, NODE_DISPATCH_TIMEOUT_MS);
            });

            return Promise.race([dispatchPromise, timeoutPromise]).then((result) => {
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

                // ── 补偿：失败节点 → abort 下游子节点 + degrade 父节点 ──
                const compensations = computeCompensation(nodeId, board);
                for (const action of compensations) {
                  if (action.event === "abort_children") {
                    try { board.failNode(action.nodeId); } catch { /* 子节点可能已终态 */ }
                    observer.emit({
                      type: PipelineEventType.NodeFailed,
                      priority: PipelinePriority.CRITICAL,
                      payload: { nodeId: action.nodeId, error: `Compensation: upstream node ${action.triggerNodeId} failed` },
                      timestamp: Date.now(),
                      notificationType: "WARNING",
                    });
                  } else if (action.event === "degrade") {
                    observer.emit({
                      type: PipelineEventType.InfraComponentDegraded,
                      priority: PipelinePriority.NORMAL,
                      payload: { operation: "compensation-degrade", nodeId: action.nodeId, detail: `Downstream node ${action.triggerNodeId} failed, degrade` },
                      timestamp: Date.now(),
                      notificationType: "WARNING",
                    });
                  }
                }
              }
              return result;
            }).catch((e) => {
              try { board.failNode(nodeId); } catch (fe) {
                if (observer) {
                  try { observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "promise-reject-fail-best-effort", detail: String(fe) }, timestamp: Date.now(), notificationType: "WARNING" }); } catch { console.error(`[scheduler] promise-reject observer.emit failed: ${String(fe)}`); }
                }
              }
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

        // 分层超时检测——每层 dispatch 后检查心跳超时
        if (ctx.agentTracker) {
          const actions = ctx.agentTracker.checkTimeouts(Date.now());
          _handleTimeoutActions(actions, ctx);
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
          try { board.failNode(n.id); } catch (fe) {
            if (observer) {
              try { observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "loop-crash-fail-best-effort", detail: String(fe) }, timestamp: Date.now(), notificationType: "WARNING" }); } catch { console.error(`[scheduler] best-effort failed: ${fe}`); }
            }
          }
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

    // ─── 悬空节点兜底 ───
    const allTopNodes = board.getAllNodes();
    const orphaned = allTopNodes.filter(
      (n: TaskNode) => n.status !== "done" && n.status !== "failed",
    );
    if (orphaned.length > 0) {
      observer.emit({
        type: PipelineEventType.SchedulerLoopCrashed,
        priority: PipelinePriority.CRITICAL,
        payload: {
          round,
          error: "Scheduler done — orphaned nodes auto-cancelled",
          pendingAtCrash: orphaned.length,
          hint: `${orphaned.length} 个节点在调度器退出时仍处于非终态，自动标记为失败`,
        },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
      for (const n of orphaned) {
        try { board.failNode(n.id); } catch (fe) {
          if (observer) {
            try { observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "orphaned-fail-best-effort", detail: String(fe) }, timestamp: Date.now(), notificationType: "WARNING" }); } catch { console.error(`[scheduler] best-effort failed: ${fe}`); }
          }
        }
        allResults.push({
          nodeId: n.id,
          success: false,
          error: `Scheduler done — orphaned node in status ${n.status}`,
        });
        failed++;
      }
    }

    observer.emit({
      type: PipelineEventType.SchedulerDone,
      priority: PipelinePriority.CRITICAL,
      payload: { total: allResults.length, completed, failed, durationMs: Date.now() - startTime, rounds: round, orphanedNodes: orphaned.length },
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
    const MAX_DURATION = ctx.config?.executeAllTimeoutMs ?? 300_000; // 默认 5 分钟全局超时
    let replanFlight: Promise<void> | null = null;

    while (true) {
      if (Date.now() - startTime > MAX_DURATION) {
        observer.emit({
          type: PipelineEventType.SchedulerLoopCrashed,
          priority: PipelinePriority.CRITICAL,
          payload: { round: 0, error: "SequentialDriver global timeout", pendingAtCrash: board.getPendingNodes().length },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
        break;
      }
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

        // 逐节点超时兜底——防止 dispatch hang 住拖死顺序执行
        const NODE_DISPATCH_TIMEOUT_MS = Math.min(ctx.config.reactLoopTimeoutMs, 120_000);
        const dispatchPromise = node.needsMultiPerspective
          ? executionModel.dispatchMulti(execCtx)
          : executionModel.dispatchSingle(execCtx);

        const timeoutPromise = new Promise<NodeResult>((resolve) => {
          setTimeout(() => {
            try { board.failNode(node.id); } catch (fe) {
              if (observer) {
                try { observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "seq-timeout-fail-best-effort", detail: String(fe) }, timestamp: Date.now(), notificationType: "WARNING" }); } catch { console.error(`[scheduler] best-effort failed: ${fe}`); }
              }
            }
            observer.emit({
              type: PipelineEventType.NodeFailed,
              priority: PipelinePriority.CRITICAL,
              payload: { nodeId: node.id, error: `Node dispatch timeout after ${NODE_DISPATCH_TIMEOUT_MS}ms` },
              timestamp: Date.now(),
              notificationType: "WARNING",
            });
            resolve({ nodeId: node.id, success: false, error: "Node dispatch timeout" });
          }, NODE_DISPATCH_TIMEOUT_MS);
        });

        try {
          const result = await Promise.race([dispatchPromise, timeoutPromise]);

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

            // ── 补偿：失败节点 → abort 下游子节点 + degrade 父节点 ──
            const compensations = computeCompensation(node.id, board);
            for (const action of compensations) {
              if (action.event === "abort_children") {
                try { board.failNode(action.nodeId); } catch { /* 子节点可能已终态 */ }
                observer.emit({
                  type: PipelineEventType.NodeFailed,
                  priority: PipelinePriority.CRITICAL,
                  payload: { nodeId: action.nodeId, error: `Compensation: upstream node ${action.triggerNodeId} failed` },
                  timestamp: Date.now(),
                  notificationType: "WARNING",
                });
              } else if (action.event === "degrade") {
                observer.emit({
                  type: PipelineEventType.InfraComponentDegraded,
                  priority: PipelinePriority.NORMAL,
                  payload: { operation: "compensation-degrade", nodeId: action.nodeId, detail: `Downstream node ${action.triggerNodeId} failed, degrade` },
                  timestamp: Date.now(),
                  notificationType: "WARNING",
                });
              }
            }
          }
        } catch (e) {
          try { board.failNode(node.id); } catch (fe) {
            if (observer) {
              try { observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "seq-catch-fail-best-effort", detail: String(fe) }, timestamp: Date.now(), notificationType: "WARNING" }); } catch { console.error(`[scheduler] best-effort failed: ${fe}`); }
            }
          }
          allResults.push({ nodeId: node.id, success: false, error: String(e).slice(0, 200) });
          failed++;
        }
      }

      // 分层超时检测——每轮节点执行后检查心跳超时
      if (ctx.agentTracker) {
        const actions = ctx.agentTracker.checkTimeouts(Date.now());
        _handleTimeoutActions(actions, ctx);
      }

      if (replanManager.hasPending && !replanFlight) {
        replanFlight = replanManager.tryFireReplan();
      }
    }

    if (replanFlight) await replanFlight;
    replanManager.resolveChains(allResults);

    // ─── 悬空节点兜底 ───
    const allSeqNodes = board.getAllNodes();
    const orphaned = allSeqNodes.filter(
      (n) => n.status !== "done" && n.status !== "failed",
    );
    if (orphaned.length > 0) {
      for (const n of orphaned) {
        try { board.failNode(n.id); } catch (fe) {
          if (observer) {
            try { observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "orphaned-fail-best-effort-sequential", detail: String(fe) }, timestamp: Date.now(), notificationType: "WARNING" }); } catch { console.error(`[scheduler] best-effort failed: ${fe}`); }
          }
        }
        allResults.push({
          nodeId: n.id,
          success: false,
          error: `Scheduler done — orphaned node in status ${n.status}`,
        });
        failed++;
      }
    }

    observer.emit({
      type: PipelineEventType.SchedulerDone,
      priority: PipelinePriority.CRITICAL,
      payload: { total: allResults.length, completed, failed, durationMs: Date.now() - startTime, rounds: 1, orphanedNodes: orphaned.length },
      timestamp: Date.now(),
      notificationType: "FYI",
    });

    return { completed, failed, results: allResults };
  }
}

/** 单条波浪定义：一组标签 → 波浪序号 */
export interface WaveDefinition {
  wave: number;
  tags: string[];
}

/** WaveDriver 默认波浪定义，按语义分组保证设计→实现→审查→验证的因果顺序 */
const DEFAULT_WAVE_DEFINITIONS: WaveDefinition[] = [
  { wave: 0, tags: ["design", "architecture", "research", "analysis", "inspect"] },
  { wave: 1, tags: ["code", "implement", "api", "data", "schema", "build"] },
  { wave: 2, tags: ["review", "fix", "refactor", "audit", "doc", "constitution"] },
  { wave: 3, tags: ["verify", "validate", "deploy", "ops", "script", "test"] },
];

/**
 * WaveDriver —— 波浪式驱动。
 *
 * 按标签语义将节点分组为波浪：
 *   Wave 0 (design)：    analysis, inspector, doc_govern 等设计/分析类节点
 *   Wave 1 (implement)：  code, api, data 等实现类节点
 *   Wave 2 (review)：     review, fix 等审查/修复类节点
 *   Wave 3 (verify)：     ops 等验证类节点
 *
 * 每波内节点按拓扑排序并行执行，波间串行——确保设计→实现→审查→验证的因果关系。
 * 未分类节点放入最后一波（兜底）。
 *
 * @param waveDefinitions 可选自定义波浪定义，不传则使用默认 4 波分组。
 *   支持从 cortex-agents.json 或外部配置读取后注入。
 */
export class WaveDriver implements ILoopDriver {
  readonly name = "wave";

  private readonly _waveDefs: WaveDefinition[];

  constructor(waveDefinitions?: WaveDefinition[]) {
    this._waveDefs = waveDefinitions && waveDefinitions.length > 0
      ? waveDefinitions
      : DEFAULT_WAVE_DEFINITIONS;
  }

  private _classifyWave(node: TaskNode): number {
    const tags = new Set(node.tags.map((t) => t.toLowerCase()));
    for (const def of this._waveDefs) {
      for (const tag of def.tags) {
        if (tags.has(tag)) return def.wave;
      }
    }
    // 未分类 → 最后一波（基于自定义定义的最大 wave + 1）
    const maxWave = this._waveDefs.reduce((m, d) => Math.max(m, d.wave), 0);
    return maxWave + 1;
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
          try { board.failNode(n.id); } catch (fe) {
            if (observer) {
              try { observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "wave-timeout-fail-best-effort", detail: String(fe) }, timestamp: Date.now(), notificationType: "WARNING" }); } catch { console.error(`[scheduler] best-effort failed: ${fe}`); }
            }
          }
          failed++;
        }
        break;
      }

      round++;
      // ── 遥测：AgentPool 空闲率 ──
      const poolStats = ctx.pool.getPoolStats();
      console.error(`[telemetry] agent_pool.idle_rate total=${poolStats.total} idle=${poolStats.idle} busy=${poolStats.busy} idleRate=${poolStats.idleRate}`);
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
        const pendingIds = new Set(pendingNodes.map((n: TaskNode) => n.id));
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
            type: PipelineEventType.SchedulerReplanLimit,
            priority: PipelinePriority.NORMAL,
            payload: { totalReplans: 0, maxReplans: 0, deferred: skipped },
            timestamp: Date.now(),
            notificationType: "FYI",
          });
        }
        waveNodes = filtered;
        if (waveNodes.length === 0) continue;

        observer.emit({
          type: PipelineEventType.SchedulerLayerStart,
          priority: PipelinePriority.HIGH,
          payload: { layer: waveIdx, nodes: waveNodes.length, round },
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

        // 分层超时检测——每层 dispatch 后检查心跳超时
        if (ctx.agentTracker) {
          const actions = ctx.agentTracker.checkTimeouts(Date.now());
          _handleTimeoutActions(actions, ctx);
        }
      }

      if (replanManager.hasPending && !replanFlight) {
        replanFlight = replanManager.tryFireReplan();
      }
    }

    if (replanFlight) await replanFlight;
    replanManager.resolveChains(allResults);

    // ─── 悬空节点兜底 ───
    const allWaveNodes = board.getAllNodes();
    const orphaned = allWaveNodes.filter(
      (n: TaskNode) => n.status !== "done" && n.status !== "failed",
    );
    if (orphaned.length > 0) {
      observer.emit({
        type: PipelineEventType.SchedulerLoopCrashed,
        priority: PipelinePriority.CRITICAL,
        payload: {
          round,
          error: "Scheduler done — orphaned nodes auto-cancelled",
          pendingAtCrash: orphaned.length,
          hint: `${orphaned.length} 个节点在调度器退出时仍处于非终态，自动标记为失败`,
        },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
      for (const n of orphaned) {
        try { board.failNode(n.id); } catch (fe) {
          if (observer) {
            try { observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "orphaned-fail-best-effort-wave", detail: String(fe) }, timestamp: Date.now(), notificationType: "WARNING" }); } catch { console.error(`[scheduler] best-effort failed: ${fe}`); }
          }
        }
        allResults.push({
          nodeId: n.id,
          success: false,
          error: `Scheduler done — orphaned node in status ${n.status}`,
        });
        failed++;
      }
    }

    observer.emit({
      type: PipelineEventType.SchedulerDone,
      priority: PipelinePriority.CRITICAL,
      payload: { total: allResults.length, completed, failed, durationMs: Date.now() - startTime, rounds: round, orphanedNodes: orphaned.length },
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
      const lastStep = steps[steps.length - 1]!;
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

    const combined = results.map((r) =>
      `[${r.agentType ?? "unknown"}]:\n${r.output ?? "(无输出)"}`
    ).join("\n\n---\n\n");

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.length - successCount;
    let summary = `[多视角结果: ${successCount}/${results.length} 成功`;
    if (failCount > 0) summary += `, ${failCount} 失败`;
    summary += `]`;

    const finalOutput = combined + "\n\n" + summary;
    const finalNode = board.getNode(node.id);
    const isDone = finalNode?.status === "done";

    return {
      nodeId: node.id,
      agentType: agentTypes[0] as AgentType,
      success: isDone || results.every((r) => r.success),
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
export class FixedModelRouter implements IModelRouter {
  readonly name = "fixed";

  async route(_node: TaskNode, _agentType: string, defaultModel: string): Promise<string> {
    return defaultModel;
  }
}

/**
 * 路由决策——由 SemanticModelRouter.route() 产出，可被 onDecision 回调消费。
 * 用于调试、成本分析和可观测性。
 */
export interface RouteDecision {
  nodeId: string;
  agentType: string;
  floorTier: ModelTier;
  assessedTier: ModelTier;
  effectiveTier: ModelTier;
  source: "recommended" | "classifier" | "classifier-cached" | "fallback";
  model: string;
  ms: number;
}

/**
 * SemanticModelRouter —— 语义驱动的模型路由，只能升级不可降级。
 *
 * **设计原则**
 * - **A 路径（甘雨标注）**：MetaAgent 规划时在 TaskNode 上设 `recommendedTier`，零成本
 * - **B 路径（LLM 分类）**：router 内置轻量 LLM 调用，对任务语义做三选一分类
 * - **Floor 保护**：Agent 注册模型所属 tier 作为最低保障线——路由只能在此基础上提高，绝不降低
 * - **降级螺旋截断**：去除所有 payload 长度等机械启发式，避免语义错判
 * - **分类器缓存**：payload 哈希为 key，避免相同/相似任务重复调用 LLM
 * - **可观测性**：通过 onDecision 回调暴露路由决策详情
 *
 * **路由优先级**
 * 1. node.recommendedTier 已设 → 直接使用（甘雨已理解任务语义）
 * 2. 缓存命中 → 复用历史分类结果
 * 3. LLM 三选一分类 → "这个任务需要 fast/standard/thinking？"
 * 4. 分类失败/超时 → 重试 → 保守回退 standard
 * 5. 最终 = max(agentFloor, assessed) —— 只能升级，不可降级
 *
 * @since v2.6.6 从 ComplexityBasedRouter 重建——六层启发式 → 语义路由 + floor
 */
export class SemanticModelRouter implements IModelRouter {
  readonly name = "semantic";

  /** 模型名 → tier 反向映射（用于计算 agent floor） */
  private readonly _modelTier: Map<string, ModelTier> = new Map();

  /** Agent 模型注册表——懒获取（Scheduler 构造时 models 尚未填充） */
  private readonly _modelsGetter: () => Map<string, string>;

  /** 分类器缓存：payload 哈希 → { tier, at } */
  private readonly _cache = new Map<number, { tier: ModelTier; at: number }>();

  /** 分类器超时（ms） */
  private readonly _classifierTimeoutMs: number;

  /** 分类器重试次数（不含首次） */
  private readonly _classifierRetries: number;

  /** 路由决策回调——用于可观测性 */
  private readonly _onDecision?: (d: RouteDecision) => void;

  /**
   * @param options.catalog 模型目录——key 为 ModelTier，value 为模型标识符。未配置的 tier 回退到 defaultModel。
   * @param options.modelsOrGetter Agent 类型 → 注册模型的 Map，或获取该 Map 的懒函数。用于计算 Agent floor。
   * @param options.classifier 可选——LLM 分类器，(payload: string) => Promise<ModelTier>。
   * @param options.classifierTimeoutMs 分类器单次调用超时（ms），默认 3000。
   * @param options.classifierRetries 分类器失败后重试次数，默认 1（共 2 次尝试）。
   * @param options.onDecision 可选——路由决策回调，用于可观测性/调试/成本分析。
   */
  constructor(options: {
    catalog: Partial<Record<ModelTier, string>>;
    modelsOrGetter?: Map<string, string> | (() => Map<string, string>);
    classifier?: (payload: string) => Promise<ModelTier>;
    classifierTimeoutMs?: number;
    classifierRetries?: number;
    onDecision?: (d: RouteDecision) => void;
  }) {
    const {
      catalog,
      modelsOrGetter,
      classifier,
      classifierTimeoutMs = 3000,
      classifierRetries = 1,
      onDecision,
    } = options;

    this.catalog = catalog;
    this.classifier = classifier;
    this._modelsGetter = typeof modelsOrGetter === "function"
      ? modelsOrGetter
      : () => modelsOrGetter ?? new Map();
    this._classifierTimeoutMs = classifierTimeoutMs;
    this._classifierRetries = classifierRetries;
    this._onDecision = onDecision;

    // 构建模型名 → tier 反向映射
    for (const [tier, modelName] of Object.entries(catalog)) {
      if (modelName) this._modelTier.set(modelName, tier as ModelTier);
    }
  }

  private readonly catalog: Partial<Record<ModelTier, string>>;
  private readonly classifier?: (payload: string) => Promise<ModelTier>;

  async route(node: TaskNode, agentType: string, defaultModel: string): Promise<string> {
    const t0 = Date.now();

    // ── Floor：Agent 注册模型所属 tier 作为最低保障线 ──
    const agentModel = this._modelsGetter().get(agentType) ?? defaultModel;
    const floorTier = this._modelTier.get(agentModel) ?? "standard";

    // ── Assess：语义判断任务所需 tier ──
    const { tier: assessedTier, source } = await this._assessTier(node.payload, node.recommendedTier);

    // ── Effective：max(floor, assessed) —— 只能升级不可降级 ──
    const effectiveTier = _maxTier(floorTier, assessedTier);
    const model = this.catalog[effectiveTier] ?? defaultModel;

    // ── 可观测性 ──
    this._onDecision?.({
      nodeId: node.id,
      agentType,
      floorTier,
      assessedTier,
      effectiveTier,
      source,
      model,
      ms: Date.now() - t0,
    });

    return model;
  }

  /**
   * 判断任务语义 tier。
   * @returns tier + 来源标记
   */
  private async _assessTier(
    payload: string,
    recommendedTier?: string,
  ): Promise<{ tier: ModelTier; source: RouteDecision["source"] }> {
    // A 路径：甘雨已在规划时标注 → 零成本
    if (recommendedTier && VALID_TIERS.has(recommendedTier)) {
      return { tier: recommendedTier as ModelTier, source: "recommended" };
    }

    // 缓存命中？
    const hash = _hashStr(payload);
    const cached = this._cache.get(hash);
    if (cached) {
      return { tier: cached.tier, source: "classifier-cached" };
    }

    // B 路径：LLM 语义分类（带超时 + 重试）
    if (this.classifier) {
      for (let attempt = 0; attempt <= this._classifierRetries; attempt++) {
        try {
          const tier = await _withTimeout(
            this.classifier(payload),
            this._classifierTimeoutMs,
          );
          if (VALID_TIERS.has(tier)) {
            this._cache.set(hash, { tier, at: Date.now() });
            return { tier, source: "classifier" };
          }
        } catch {
          // 超时或异常——重试或回退
          console.error(`[scheduler] classifier timeout/error at attempt ${attempt}`);
        }
      }
    }

    // 保守回退：不猜了
    return { tier: "standard", source: "fallback" };
  }

  /**
   * 静态工厂：创建一个基于 LlmCallable 的简单分类器。
   * 用 flash 模型做语义三选一，适合绝大多数场景。
   *
   * @param llm LLM 调用入口（通常来自 MetaAgent.llm.chat）
   * @param model 分类用的模型名，默认 "deepseek-v4-flash"
   */
  static createSimpleClassifier(
    llm: (model: string, messages: Array<{ role: string; content: string }>) => Promise<string>,
    model = "deepseek-v4-flash",
  ): (payload: string) => Promise<ModelTier> {
    return async (payload: string): Promise<ModelTier> => {
      const resp = await llm(model, [{
        role: "system",
        content: [
          "You are the Cortex model router. Classify tasks into exactly one tier.",
          "- fast: trivial confirmations, comment changes, simple lookups",
          "- standard: everyday coding, reviews, moderate complexity",
          "- thinking: architecture analysis, deep refactors, constitution audits, multi-file reasoning",
          "Output ONLY one word: fast, standard, or thinking.",
        ].join("\n"),
      }, {
        role: "user",
        content: payload.slice(0, 2000),
      }]);
      const tier = resp.trim().toLowerCase();
      return VALID_TIERS.has(tier) ? tier as ModelTier : "standard";
    };
  }
}

/** 合法 tier 值集合（用于校验甘雨标注和分类器输出）
 * 单源定义 @cortex/config/constants/tiers */

/** Tier 排序：fast < standard < thinking */
const TIER_ORDER: Record<ModelTier, number> = { fast: 0, standard: 1, thinking: 2 };

function _maxTier(a: ModelTier, b: ModelTier): ModelTier {
  return TIER_ORDER[a] >= TIER_ORDER[b] ? a : b;
}

/** 简单字符串哈希（DJB2）——用于分类器缓存 key */
function _hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h;
}

/** 为 Promise 加超时——超时时 reject */
function _withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return p;
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
    ),
  ]);
}
