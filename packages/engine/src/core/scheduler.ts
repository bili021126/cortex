// @cortex/engine/core/scheduler —— 调度中枢
// @layer 规划-执行层
// @role 事轴中枢——executeAll() 拓扑排序 + 逐层并行 dispatch

import { AgentStatus, PipelineEventType, PipelinePriority } from "@cortex/shared";
import type { Agent, AgentType, ExecutionReport, IMemoryStore, IPipelineObserver, NodeResult, TaskNode } from "@cortex/shared";
import type { MetaAgent } from "./meta-agent.js";
import { MetaAgentReplanAdapter } from "./meta-agent-adapter.js";
import { ReplanManager, findAllMatchingAgents, ClaimStep, SpawnStep, RlmExecuteStep, BoundaryGuardStep, CleanupStep, TagMatchingStrategy, TopologicalLayeredDriver, PipelineModel, FixedModelRouter, type ITaskBoard, type ISchedulerAgentPool, type DispatchCtx, type IDispatchStep, type LlmCallable, type IScheduler, type IScheduleStrategy, type ILoopDriver, type IExecutionModel, type IModelRouter, type CompositeSchedulerConfig, type LoopContext } from "@cortex/scheduler";
import { isTestEnv } from "@cortex/config";
import { resolveConfig } from "@cortex/config";
import type { EngineConfig } from "@cortex/config";

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
 * @merge-complete Core-1 调度器双实现合并（v2.6.6→v2.6.7）：
 *   CompositeScheduler 的三抽象（IScheduleStrategy/ILoopDriver/IExecutionModel/IModelRouter）
 *   已全部吸收进 Scheduler。CompositeScheduler 类已从 @cortex/scheduler 移除。
 *   schedulerConfig?: CompositeSchedulerConfig 可选参数保留三抽象可替换性。
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
  // @role 恢复者——ReplanManager 仅通过 Scheduler 被 MetaAgent 间接触发
  private readonly config: Required<EngineConfig>;
  // 四抽象组件（默认行为与原 Scheduler 完全一致）
  readonly strategy: IScheduleStrategy;
  readonly loopDriver: ILoopDriver;
  readonly executionModel: IExecutionModel;
  modelRouter: IModelRouter;
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
    schedulerConfig?: CompositeSchedulerConfig,
  ) {
    this.config = resolveConfig(engineConfig);
    this.replanManager = new ReplanManager(board, observer, metaAgent ? new MetaAgentReplanAdapter(metaAgent) : undefined, this.config);
    this.strategy = schedulerConfig?.strategy ?? new TagMatchingStrategy();
    this.loopDriver = schedulerConfig?.loopDriver ?? new TopologicalLayeredDriver();
    this.executionModel = schedulerConfig?.executionModel ?? new PipelineModel();
    this.modelRouter = schedulerConfig?.modelRouter ?? new FixedModelRouter();
  }

  /** Core-2: 替换模型路由器（供 bootstrap 注入 TaskRouter + EnvironmentAwareRouter 组合） */
  setModelRouter(router: IModelRouter): void {
    this.modelRouter = router;
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

    // 构建 LoopContext，注入 dispatchNode 保留完整 RLM 拆解管线
    const loopCtx: LoopContext = {
      board: this.board,
      pool: this.pool,
      observer: this.observer,
      agents: this.agents,
      models: this.models,
      replanProvider: this.metaAgent ? new MetaAgentReplanAdapter(this.metaAgent) : undefined,
      replanManager: this.replanManager,
      config: this.config,
      strategy: this.strategy,
      executionModel: this.executionModel,
      modelRouter: this.modelRouter,
      dispatchNode: (node) => this._dispatchNode(node.id),
    };

    const loopResult = await this.loopDriver.run(loopCtx);

    // MemoryStore endSession 已迁移至 ShutdownWarden（统一管理 shutdown 生命周期）

    const durationMs = Date.now() - startTime;
    const allNodes = this.board.getAllNodes();

    return {
      totalNodes: allNodes.length,
      completed: loopResult.completed,
      failed: loopResult.failed,
      results: loopResult.results,
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
      modelRouter: this.modelRouter,
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
        modelRouter: this.modelRouter,
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
