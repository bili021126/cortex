/**
 * drivers —— 调度四抽象之实现（由 scheduling-implementations.ts 拆分，2026-06-20 SCH-1）。
 *
 * 拆分自原 1457 行单文件：strategies / drivers / execution-models / model-routers。
 */

import { PipelineEventType, PipelinePriority, type NodeResult, type PipelineHandler, type TaskNode } from "@cortex/shared";
import type { ILoopDriver, LoopContext, LoopResult, ExecutionContext } from "./scheduling-types.js";
import type { TimeoutAction } from "./agent-tracker.js";
import { topologicalSort } from "./topological-sort.js";
import { NODE_DISPATCH_TIMEOUT_MS as CFG_NODE_DISPATCH_TIMEOUT, EXECUTE_ALL_TIMEOUT_MS } from "@cortex/config";
import type { DispatchCtx, IDispatchStep } from "../dispatch-steps/types.js";
import { isTestEnv } from "../utils/internal.js";
import { computeCompensation } from "./compensation.js";
import { telemetryController, TelemetryLevel } from "@cortex/telemetry";

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
        // R12-B2：ping 保守化——agentId 与 pool 的 instanceId 键空间可能错配（查不到≠死亡）——
        // 不判死 failNode（节点级超时 race 是主兜底）——只发事件，L3 kill 仍由 checkTimeouts 按 lastHeartbeat 触发
        void ctx.pool.ping(a.agentId).then((alive) => {
          if (!alive) {
            ctx.observer.emit({
              type: PipelineEventType.ExecNodeDelayed,
              priority: PipelinePriority.NORMAL,
              payload: { nodeId: a.nodeId, agentId: a.agentId, elapsed: a.elapsed, action: 'wait', level: 'warn' },
              timestamp: Date.now(),
              notificationType: "WARNING",
            });
          }
        }).catch(() => { /* 键错配/实例已回收——不判死（B1 race 兜底） */ });
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

/** P2 fix: ping 探测确认节点死亡（或 ping 自身异常）——升级为 failNode + NodeFailed，不静默 */
function _handlePingDead(ctx: LoopContext, a: TimeoutAction, reason?: string): void {
  try {
    ctx.board.failNode(a.nodeId);
  } catch (e) {
    try {
      ctx.observer.emit({
        type: PipelineEventType.InfraComponentDegraded,
        priority: PipelinePriority.NORMAL,
        payload: { operation: "agent-ping-kill-best-effort", detail: String(e) },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    } catch { console.error(`[scheduler] best-effort ping kill failed: ${e}`); }
  }
  ctx.observer.emit({
    type: PipelineEventType.NodeFailed,
    priority: PipelinePriority.CRITICAL,
    payload: { nodeId: a.nodeId, error: reason ?? `Agent ping dead after ${a.elapsed}ms` },
    timestamp: Date.now(),
    notificationType: "WARNING",
  });
}

/**
 * TagMatchingStrategy —— 默认标签匹配策略。
 *
 * 行为与现有 Scheduler 完全一致：
 * 1. 先按 node.type 精确匹配 AgentType
 * 2. 回退按 tags 打分匹配（AGENT_TAGS）
 * 3. 平局按匹配密度打破
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
                round++;
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
        // ── 遥测：AgentPool 空闲率（S2-6：直接入 telemetryController，
        //    value 为真实 idleRate——此前 console.error 间接路径解析到 total，数据错位）
        const poolStats = ctx.pool.getPoolStats();
        telemetryController.record({
          metric: "agent_pool.idle_rate",
          value: poolStats.idleRate,
          level: TelemetryLevel.TRACE,
          tags: { total: poolStats.total, idle: poolStats.idle, busy: poolStats.busy },
        });
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
            payload: { nodeId: pendingNodes[0]?.id ?? "unknown", message: `Circular dependency detected among ${pendingNodes.length} pending nodes` },
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
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
              // R12-B1：节点级超时 race——dispatchNode 可能永不 resolve（hang）——全局 deadline 只在轮首检查，层内 allSettled 期间不可达
              // R13-N1：模板串 TDZ 修复（原引用 269 行局部 const——dispatchNode 分支提前 return 永不初始化→ReferenceError）
              //        + clearTimeout（原无——每次 dispatch 后 120s 定时器必触发——生产定时炸弹）
              let raceTid: ReturnType<typeof setTimeout> | undefined;
              const raceTimeout = new Promise<NodeResult>((resolve) => {
                raceTid = setTimeout(() => {
                  try { board.failNode(nodeId); } catch { /* 节点已失败 */ }
                  resolve({ nodeId, success: false, error: `dispatch timeout after ${CFG_NODE_DISPATCH_TIMEOUT}ms` });
                }, CFG_NODE_DISPATCH_TIMEOUT);
              });
              return Promise.race([
                ctx.dispatchNode(node).catch((e) => {
                  try { board.failNode(nodeId); } catch (fe) {
                    if (observer) {
                      try { observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "dispatch-node-reject-fail-best-effort", detail: String(fe) }, timestamp: Date.now(), notificationType: "WARNING" }); } catch { console.error(`[scheduler] dispatch-node-reject observer.emit failed: ${String(fe)}`); }
                    }
                  }
                  return { nodeId, success: false, error: `Promise rejected: ${String(e).slice(0, 200)}` } as NodeResult;
                }),
                raceTimeout,
              ]).then((r) => { clearTimeout(raceTid); return r; });
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
            const NODE_DISPATCH_TIMEOUT_MS = Math.min(config.reactLoopTimeoutMs, CFG_NODE_DISPATCH_TIMEOUT);
            let tid: ReturnType<typeof setTimeout>;
            const timeoutPromise = new Promise<NodeResult>((resolve) => {
              tid = setTimeout(() => {
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

            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return Promise.race([dispatchPromise.then((r) => { clearTimeout(tid!); return r; }), timeoutPromise]).then((result) => {
              // ── 终态守卫：超时已 failNode 或节点已终态 → 跳过 enqueue 与补偿逻辑 ──
              // 防止 timeoutPromise 触发 failNode 后 dispatchPromise 仍完成时产生重复 replan / 二次补偿
              const terminalStatus = board.getNode(nodeId)?.status;
              if (terminalStatus === "failed" || terminalStatus === "done") {
                return result;
              }

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
                    try { board.failNode(action.nodeId); } catch (fe) { observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "compensation-abort_children-failNode", detail: String(fe) }, timestamp: Date.now(), notificationType: "WARNING" }); }
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
    const MAX_DURATION = ctx.config?.executeAllTimeoutMs ?? EXECUTE_ALL_TIMEOUT_MS;
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
        const NODE_DISPATCH_TIMEOUT_MS2 = Math.min(ctx.config.reactLoopTimeoutMs, CFG_NODE_DISPATCH_TIMEOUT);
        const dispatchPromise = node.needsMultiPerspective
          ? executionModel.dispatchMulti(execCtx)
          : executionModel.dispatchSingle(execCtx);

        let tid2: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<NodeResult>((resolve) => {
          tid2 = setTimeout(() => {
            try { board.failNode(node.id); } catch (fe) {
              if (observer) {
                try { observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "seq-timeout-fail-best-effort", detail: String(fe) }, timestamp: Date.now(), notificationType: "WARNING" }); } catch { console.error(`[scheduler] best-effort failed: ${fe}`); }
              }
            }
            observer.emit({
              type: PipelineEventType.NodeFailed,
              priority: PipelinePriority.CRITICAL,
              payload: { nodeId: node.id, error: `Node dispatch timeout after ${NODE_DISPATCH_TIMEOUT_MS2}ms` },
              timestamp: Date.now(),
              notificationType: "WARNING",
            });
            resolve({ nodeId: node.id, success: false, error: "Node dispatch timeout" });
          }, NODE_DISPATCH_TIMEOUT_MS2);
        });

        try {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const result = await Promise.race([dispatchPromise.then((r) => { clearTimeout(tid2!); return r; }), timeoutPromise]);

          // ── 终态守卫：超时已 failNode 或节点已终态 → 跳过 enqueue 与补偿逻辑 ──
          // 防止 timeoutPromise 触发 failNode 后 dispatchPromise 仍完成时产生重复 replan / 二次补偿
          const terminalStatus = board.getNode(node.id)?.status;
          if (terminalStatus !== "failed" && terminalStatus !== "done") {
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
 *   支持从 agents 配置域或外部配置读取后注入。
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
      // ── 遥测：AgentPool 空闲率（S2-6：同轮询驱动，value 为真实 idleRate）
      const poolStats = ctx.pool.getPoolStats();
      telemetryController.record({
        metric: "agent_pool.idle_rate",
        value: poolStats.idleRate,
        level: TelemetryLevel.TRACE,
        tags: { total: poolStats.total, idle: poolStats.idle, busy: poolStats.busy },
      });
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
        // ── 环形依赖防护：与 TopologicalLayeredDriver 对齐——emit 环警告 + failNode 全部 waveNodes + continue ──
        // 否则 layers.length === 0 时 for 循环空转，while(true) 纯同步忙循环阻塞事件循环
        if (layers.length === 0 && waveNodes.length > 0) {
          observer.emit({
            type: PipelineEventType.SchedulerInvariantViolation,
            priority: PipelinePriority.CRITICAL,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            payload: { nodeId: waveNodes[0]!.id, message: `WaveDriver circular dependency detected among ${waveNodes.length} wave nodes` },
            timestamp: Date.now(),
            notificationType: "WARNING",
          });
          for (const n of waveNodes) {
            try { board.failNode(n.id); } catch (fe) {
              if (observer) {
                try { observer.emit({ type: PipelineEventType.InfraComponentDegraded, priority: PipelinePriority.NORMAL, payload: { operation: "wave-circular-fail-best-effort", detail: String(fe) }, timestamp: Date.now(), notificationType: "WARNING" }); } catch { console.error(`[scheduler] wave-circular observer.emit failed: ${String(fe)}`); }
              }
            }
            allResults.push({ nodeId: n.id, success: false, error: "Circular dependency" });
            failed++;
          }
          continue;
        }

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

/** 执行 IDispatchStep 管线。异常安全：任何 step throw 时保障 CleanupStep 执行 */
export async function runDispatchPipeline(ctx: DispatchCtx, steps: IDispatchStep[]): Promise<NodeResult> {
  const lastStep = steps[steps.length - 1];
  try {
    for (const step of steps) {
      ctx = await step.run(ctx);
      if (ctx.result && !ctx.result.success && step.name !== "Cleanup") {
        const result = ctx.result;
        if (lastStep?.name === "Cleanup") {
          await lastStep.run(ctx);
        }
        return result;
      }
    }
    return ctx.result ?? { nodeId: ctx.node.id, success: false, error: "Dispatch completed without result" };
  } catch (err) {
    // 异常路径：确保 CleanupStep 执行以释放 claimedBy/ManifoldGate/Pool
    if (lastStep?.name === "Cleanup") {
      try { await lastStep.run(ctx); } catch { /* Cleanup 自身异常不传播 */ }
    }
    throw err;
  }
}

/**
 * PipelineModel —— 默认管线执行范式。
 *
 *   单视角：Claim → Spawn → Execute → BoundaryGuard → Cleanup
 *   多视角：直接 Execute → Cleanup
 */
