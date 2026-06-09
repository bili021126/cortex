import { AgentStatus, PipelineEventType, PipelinePriority, type Agent, type AgentType, type ExecutionReport, type IMemoryStore, type IPipelineObserver, type NodeResult, type PipelineHandler, type TaskNode } from "@cortex/shared";
import type { ITaskBoard } from "./task-board.js";
import type { ISchedulerAgentPool } from "./agent-pool.js";
import type { MetaAgent } from "./meta-agent.js";
import { topologicalSort } from "./topological-sort.js";
import { findAllMatchingAgents } from "./agent-matcher.js";
import { ReplanManager } from "./replan-manager.js";
import { isTestEnv } from "../test-env.js";
import { type EngineConfig, resolveConfig } from "@cortex/config";
import type { DispatchCtx, IDispatchStep } from "./dispatch-steps/types.js";
import type { LlmCallable } from "./rlm-decompose.js";
import { ClaimStep } from "./dispatch-steps/claim-step.js";
import { SpawnStep } from "./dispatch-steps/spawn-step.js";
import { RlmExecuteStep } from "./dispatch-steps/rlm-execute-step.js";
import { BoundaryGuardStep } from "./dispatch-steps/boundary-guard-step.js";
import { CleanupStep } from "./dispatch-steps/cleanup-step.js";

/**
 * IScheduler —— 调度器公开接口。
 * Scheduler 实现此接口，CLI/EngineBridge/Bootstrap 通过此接口依赖 Scheduler。
 * @since v2.8 核心组件接口化与组合式重构
 */
export interface IScheduler {
  register(agentType: string, agent: Agent, model: string): void;
  executeAll(): Promise<ExecutionReport>;
}

/**
 * Scheduler —— 调度引擎。
 *
 * 职责：
 * 1. 拓扑排序任务树
 * 2. 逐层并行分发节点给匹配的 AgentRunner
 * 3. 通过 PipelineObserver 发布节点生命周期事件
 * 4. 产出 ExecutionReport
 *
 * @contract 模块边界契约（久岐忍 P1-5：模块边界缺少显式契约化定义 → 已闭合）
 *
 * @depends  task-board.ts（claim/release/complete/failNode/getPendingNodes）
 * @depends  agent-pool.ts（spawn/destroy，实例生命周期）
 * @depends  pipeline-observer.ts（事件发射，双通道 reporter）
 * @depends  meta-agent.ts（重规划逻辑，可选——缺则 replanQueue 静默排空）
 * @depends  @cortex/shared（AgentType, AGENT_TAGS, TaskNode, PipelineEventType 等类型）
 * @dataflow Scheduler 是调度中枢：TaskBoard(输入) → 拓扑排序 → dispatch → AgentPool(执行)
 *           → TaskBoard.complete(落盘) → observer.emit(事件) → ExecutionReport(输出)
 *           MetaAgent 通过 replanQueue 旁路注入新节点（领而不执），不参与主执行路径
 *
 *   ┌─ Scheduler ─┐
 *   │  register()  │◄── Agent + Model（构造时注入）
 *   │  executeAll()│──► TaskBoard.claim() → release() → complete() / failNode()
 *   │              │──► AgentPool.spawn() → destroy()
 *   │              │──► MetaAgent.requestReplan() → 新节点入板（领而不执）
 *   │              │──► PipelineObserver.emit()（双通道：observer + console）
 *   └──────────────┘
 *
 *   前置条件：
 *   - TaskBoard 已填充节点（至少一个 pending）
 *   - AgentPool 已注册 Runner（register() 或直接注入 agents Map）
 *   - PipelineObserver 已构建（constructor 注入，非 null）
 *   - MetaAgent 可选（缺则重规划队列静默排空）
 *
 *   后置条件：
 *   - ExecutionReport 完整（totalNodes/completed/failed/results/durationMs）
 *   - 所有节点终态为 done 或 failed（无 pending/claimed 残留）
 *   - Pool 实例已全部 destroy（spawn 对等释放）
 *
 *   异常语义：
 *   - executeAll() 单轮异常不崩溃：标记当前 pending 为 failed，上报 SchedulerLoopCrashed，break 返回已有结果
 *   - execute() 抛异常：不阻断 complete 落盘
 *   - destroy() 抛异常：上报 PoolDestroyFailed，不阻断
 *
 * **订阅者注册**：PipelineObserver 的订阅者（Sentinel/MemoryStore/管家）
 * 由 bootstrap 入口点在 Scheduler 构造前注册，不在 Scheduler 内部隐式注册。
 * 订阅约定见 PipelineObserver.emit() 注释。
 */
export class Scheduler implements IScheduler {
  private agents = new Map<string, Agent>();
  private models = new Map<string, string>();
  private readonly replanManager: ReplanManager;
  private readonly config: Required<EngineConfig>;
  /** 当前运行会话标识——executeAll() 启动时生成 */
  private _sessionId?: string;
  /** MemoryStore 引用——用于 beginSession/endSession 生命周期管理 */
  private _memoryStore?: IMemoryStore;

  constructor(
    private readonly board: ITaskBoard,
    private readonly pool: ISchedulerAgentPool,
    private readonly observer: IPipelineObserver,
    private readonly metaAgent?: MetaAgent,
    engineConfig?: EngineConfig,
  ) {
    this.config = resolveConfig(engineConfig);
    this.replanManager = new ReplanManager(board, observer, metaAgent, this.config);
  }

  /** 注册一个 AgentRunner 及其所用模型 */
  register(agentType: string, agent: Agent, model: string): void {
    this.agents.set(agentType, agent);
    this.models.set(agentType, model);
  }

  /** 注入 MemoryStore——用于 executeAll() 的 sessionId 生命周期管理 */
  setMemoryStore(memory: IMemoryStore): void {
    this._memoryStore = memory;
  }

  /** 构建 RLM 拆解用的 LLM 调用入口。从 MetaAgent 的 LlmAdapter 桥接。 */
  private _buildLlmChat(): LlmCallable | undefined {
    const adapter = this.metaAgent?.llmAdapter;
    if (!adapter) return undefined;
    return async (model: string, messages: Array<{ role: string; content: string }>) => {
      const res = await adapter.chat(model, messages as Parameters<typeof adapter.chat>[1]);
      return res.content ?? "";
    };
  }

  /**
   * 执行 TaskBoard 上全部节点。
   * 动态消费模式：只要有 pending/claimed 节点就继续拓扑排序 + 逐层并行执行。
   * 每轮执行后处理 replanQueue，MetaAgent 产出新节点仅入板不执行——
   * 由下一轮循环统一调度（"领而不执"）。
   */
  async executeAll(): Promise<ExecutionReport> {
    const startTime = Date.now();
    // v2.5.41: 生成 sessionId——每次 executeAll() 唯一标识，注入 MetaAgent 管线上下文
    this._sessionId = `run-${startTime}-${Math.random().toString(36).slice(2, 8)}`;
    // 激活 MemoryStore 会话——后续 write/writePending 自动注入此 sessionId
    this._memoryStore?.beginSession(this._sessionId);
    const allResults: NodeResult[] = [];
    let completed = 0;
    let failed = 0;
    let round = 0;
    let replanFlight: Promise<void> | null = null;
    const deadline = startTime + this.config.executeAllTimeoutMs;

    // ─── 边界违规事件监听：Agent 越界写文件 → 入队 replanManager → MetaAgent 重规划 ───
    const boundaryHandler: PipelineHandler = (event) => {
      if (event.type === PipelineEventType.AgentBoundaryViolation) {
        const payload = event.payload as { nodeId: string; reason: string };
        const node = this.board.getNode(payload.nodeId);
        if (node) {
          this.replanManager.enqueue(node, payload.reason, "boundary_violation");
        }
      }
    };
    this.observer.on(PipelinePriority.HIGH, boundaryHandler);

    while (true) {
      // ── 全局超时检查 ──
      if (Date.now() >= deadline) {
        const remaining = this.board.getPendingNodes();
        for (const n of remaining) {
          allResults.push({ nodeId: n.id, success: false, error: `Scheduler global timeout (round ${round})` });
          try { this.board.failNode(n.id); } catch { /* best-effort */ }
          failed++;
        }
        this.observer.emit({
          type: PipelineEventType.SchedulerLoopCrashed,
          priority: PipelinePriority.CRITICAL,
          payload: {
            round,
            error: "ExecuteAll timeout",
            pendingAtCrash: remaining.length,
            hint: `全局超时 ${this.config.executeAllTimeoutMs}ms，${remaining.length} 个节点标记为失败`,
          },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
        break;
      }

      try {
      round++;
      const pendingNodes = this.board.getPendingNodes();

      if (pendingNodes.length === 0) {
        if (replanFlight) {
          await replanFlight;
          replanFlight = null;
        }
        if (this.board.getPendingNodes().length > 0) continue;
        if (this.replanManager.hasPending) {
          replanFlight = this.replanManager.tryFireReplan();
          continue;
        }
        break;
      }

      const layers = topologicalSort(pendingNodes, this.observer);

      if (layers.length === 0 && pendingNodes.length > 0) {
        const msg = `Circular dependency detected among ${pendingNodes.length} pending nodes — marking all as failed`;
        this.observer.emit({
          type: PipelineEventType.SchedulerInvariantViolation,
          priority: PipelinePriority.CRITICAL,
          payload: {
            nodeId: pendingNodes[0].id,
            message: msg,
          },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
        for (const n of pendingNodes) {
          try { this.board.failNode(n.id); } catch { /* best-effort */ }
          allResults.push({ nodeId: n.id, success: false, error: "Circular dependency detected — node cannot be scheduled" });
          failed++;
        }
        continue;
      }

      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        this.observer.emit({
          type: PipelineEventType.SchedulerLayerStart,
          priority: PipelinePriority.HIGH,
          payload: { layer: li, nodes: layer.length, round },
          timestamp: Date.now(),
          notificationType: "FYI",
        });

        const layerPromises = layer.map((nodeId) => this._dispatchNode(nodeId));
        const settled = await Promise.allSettled(layerPromises);

        for (let si = 0; si < settled.length; si++) {
          const r = settled[si];
          if (r.status === "fulfilled") {
            allResults.push(r.value);
            if (r.value.success) completed++;
            else failed++;
          } else {
            const nodeId = layer[si];
            try { this.board.failNode(nodeId); } catch { /* best-effort */ }
            allResults.push({ nodeId, success: false, error: `Promise rejected: ${String(r.reason).slice(0, 200)}` });
            failed++;
          }
        }
      }

      if (this.replanManager.hasPending && !replanFlight) {
        replanFlight = this.replanManager.tryFireReplan();
      }
      } catch (loopErr) {
        const snappedPending = this.board.getPendingNodes();
        this.observer.emit({
          type: PipelineEventType.SchedulerLoopCrashed,
          priority: PipelinePriority.CRITICAL,
          payload: {
            round,
            error: String(loopErr).slice(0, 300),
            pendingAtCrash: snappedPending.length,
            hint: "当前轮次因未预期异常中断，pending 节点将标记为失败",
          },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
        for (const n of snappedPending) {
          try { this.board.failNode(n.id); } catch (e) {
            if (this.observer) {
              this.observer.emit({
                type: PipelineEventType.SchedulerInvariantViolation,
                priority: PipelinePriority.HIGH,
                payload: { nodeId: n.id, message: `failNode best-effort failed: ${String(e)}`, error: String(e).slice(0, 200) },
                timestamp: Date.now(),
                notificationType: "WARNING",
              });
            }
            console.error(`[scheduler] failNode best-effort failed for ${n.id}: ${String(e)}`);
          }
          allResults.push({ nodeId: n.id, success: false, error: `Scheduler loop crashed at round ${round}` });
          failed++;
        }
        this.replanManager.reset();
        break;
      }
    }

    if (replanFlight) await replanFlight;

    this.replanManager.resolveChains(allResults);
    let actualCompleted = 0;
    let actualFailed = 0;
    for (const r of allResults) {
      if (r.success) actualCompleted++;
      else actualFailed++;
    }
    completed = actualCompleted;
    failed = actualFailed;
    this.replanManager.reset();

    // 退订边界违规监听
    this.observer.off(PipelinePriority.HIGH, boundaryHandler);

    // 终结 MemoryStore 会话——归档 Active 记忆，湮灭 Pending 记忆
    this._memoryStore?.endSession().catch(() => { /* best-effort */ });

    const durationMs = Date.now() - startTime;
    const allNodes = this.board.getAllNodes();

    // ─── 悬空节点兜底：正常退出后仍处于非终态的节点自动取消 ───
    const orphaned = allNodes.filter(
      (n) => n.status !== "done" && n.status !== "failed",
    );
    if (orphaned.length > 0) {
      this.observer.emit({
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
        try { this.board.failNode(n.id); } catch { /* best-effort */ }
        allResults.push({
          nodeId: n.id,
          success: false,
          error: `Scheduler done — orphaned node in status ${n.status}`,
        });
        failed++;
      }
    }

    this.observer.emit({
      type: PipelineEventType.SchedulerDone,
      priority: PipelinePriority.CRITICAL,
      payload: {
        total: allNodes.length,
        completed,
        failed,
        durationMs,
        rounds: round,
        orphanedNodes: orphaned.length,
      },
      timestamp: Date.now(),
      notificationType: "FYI",
    });

    return {
      totalNodes: allNodes.length,
      completed,
      failed,
      results: allResults,
      durationMs,
      sessionId: this._sessionId,
    };
  }

  private async _dispatchNode(nodeId: string): Promise<NodeResult> {
    const node = this.board.getNode(nodeId);
    if (!node) {
      return { nodeId, success: false, error: "Node not found" };
    }

    this.observer.emit({
      type: PipelineEventType.NodeStart,
      priority: PipelinePriority.HIGH,
      payload: { nodeId, type: node.type },
      timestamp: Date.now(),
      notificationType: "FYI",
    });

    let result: NodeResult;
    try {
      if (node.needsMultiPerspective) {
        result = await this._dispatchMulti(node);
      } else {
        result = await this._dispatchSingle(node);
      }
    } catch (e) {
      result = {
        nodeId,
        success: false,
        error: String(e),
      };
    }

    if (!result.success) {
      const reason = result.output ?? result.error ?? "unknown";
      this.replanManager.enqueue(node, reason);
    }

    if (!result.success) {
      this.observer.emit({
        type: PipelineEventType.NodeFailed,
        priority: PipelinePriority.CRITICAL,
        payload: { nodeId, error: result.error ?? "unknown" },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    }

    return result;
  }

  /**
   * 按顺序执行 IDispatchStep 数组。
   * - 非 Cleanup 步骤返回失败结果时立即终止，但仍运行 CleanupStep
   *   确保 board.complete() 落盘 + pool.destroy() 释放，防止节点卡 claimed 状态。
   * - CleanupStep 始终运行（保证池销毁 + 落盘）
   * @fix P0-1: 非 Cleanup 步骤失败后仍执行 CleanupStep，消除 double-counted 与 NodeFailed 重复发射
   */
  private async _runDispatchPipeline(ctx: DispatchCtx, steps: IDispatchStep[]): Promise<NodeResult> {
    for (const step of steps) {
      ctx = await step.run(ctx);
      if (ctx.result && !ctx.result.success && step.name !== "Cleanup") {
        // 失败时仍运行 CleanupStep（最后一步）以确保落盘释放
        // 其内部 guard (!agentType || !instanceId || !result) 保证前置条件不满足时安全 no-op
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

  /** 单视角节点：Claim → Spawn → [SkillInjection] → Execute → Cleanup */
  private async _dispatchSingle(node: TaskNode): Promise<NodeResult> {
    const ctx: DispatchCtx = {
      agents: this.agents,
      models: this.models,
      board: this.board,
      pool: this.pool,
      observer: this.observer,
      isTestEnv: isTestEnv(),
      node,
      llmChat: this._buildLlmChat(),
    };

    const steps: IDispatchStep[] = [
      new ClaimStep(),
      new SpawnStep(this.config.manifoldGateAcquireTimeoutMs),
      new RlmExecuteStep(),
      new BoundaryGuardStep(),
      new CleanupStep(),
    ];

    return await this._runDispatchPipeline(ctx, steps);
  }

  /** 多视角节点：所有匹配 Agent 并行执行 Claim → Spawn → Execute → Cleanup */
  private async _dispatchMulti(node: TaskNode): Promise<NodeResult> {
    const agentTypes = findAllMatchingAgents(this.agents, node);

    if (agentTypes.length === 0) {
      this.board.failNode(node.id);
      return {
        nodeId: node.id,
        success: false,
        error: `No agents match multi-perspective node ${node.id}`,
      };
    }

    const promises = agentTypes.map(async (at) => {
      const agent = this.agents.get(at);
      if (!agent) return null;

      if (agent.status !== AgentStatus.Awake && agent.status !== AgentStatus.Active) return null;

      const innerCtx: DispatchCtx = {
        agents: this.agents,
        models: this.models,
        board: this.board,
        pool: this.pool,
        observer: this.observer,
        isTestEnv: isTestEnv(),
        node,
        agentType: at,
        agent,
        llmChat: this._buildLlmChat(),
      };

      const claimed = this.board.claim(node.id, at as AgentType);
      if (!claimed) return null;

      innerCtx.model = this.models.get(at) ?? "mock";

      const steps: IDispatchStep[] = [
        new SpawnStep(this.config.manifoldGateAcquireTimeoutMs),
        new RlmExecuteStep(),
        new BoundaryGuardStep(),
        new CleanupStep(),
      ];

      return await this._runDispatchPipeline(innerCtx, steps);
    });

    const results = (await Promise.all(promises)).filter((r): r is NonNullable<typeof r> => r !== null);

    if (results.length > 0) {
      const currentNode = this.board.getNode(node.id);
      if (currentNode && currentNode.status !== "failed") {
        const resultTypes = new Set(results.map((r) => r.agentType).filter((t): t is AgentType => t != null));
        for (const at of currentNode.claimedBy) {
          if (!resultTypes.has(at)) {
            this.observer.emit({
              type: PipelineEventType.SchedulerInvariantViolation,
              priority: PipelinePriority.CRITICAL,
              payload: {
                nodeId: node.id,
                message: `claimedBy 中 ${at} 无对应 result — claimedBy=[${currentNode.claimedBy}], results=[${[...resultTypes]}]`,
              },
              timestamp: Date.now(),
            });
          }
        }
      }
    }

    if (results.length === 0) {
      this.board.failNode(node.id);
      return {
        nodeId: node.id,
        success: false,
        error: "All agents failed to claim multi-perspective node",
      };
    }

    const combined = results.map((r) => `[${r.agentType}] ${r.output ?? r.error}`).join("\n");
    const allSuccess = results.every((r) => r.success);

    // @fix P0-3: 部分视角 spawn 失败时（如 pool 耗尽 → release），其余视角成功后
    //   board.complete() 已将节点置为 done。以 board 终态为准，而非机械聚合 allSuccess。
    const finalNode = this.board.getNode(node.id);
    const isDone = finalNode?.status === "done";

    if (isDone) {
      this.observer.emit({
        type: PipelineEventType.NodeComplete,
        priority: PipelinePriority.HIGH,
        payload: {
          nodeId: node.id,
          agentType: agentTypes[0] as AgentType,
          success: true as const,
          output: combined,
          perspectives: results.map((r) => r.agentType),
          allSuccess: true,
        },
        timestamp: Date.now(),
      });
    }

    return {
      nodeId: node.id,
      agentType: agentTypes[0] as AgentType,
      success: isDone || allSuccess,
      output: combined,
    };
  }
}
