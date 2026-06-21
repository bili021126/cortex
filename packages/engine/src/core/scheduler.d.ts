import type { Agent, ExecutionReport, IMemoryStore, IPipelineObserver } from "@cortex/shared";
import type { MetaAgent } from "./meta-agent.js";
import { type ITaskBoard, type ISchedulerAgentPool, type IScheduler, type IScheduleStrategy, type ILoopDriver, type IExecutionModel, type IModelRouter, type CompositeSchedulerConfig } from "@cortex/scheduler";
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
export declare class Scheduler implements IScheduler {
    private readonly board;
    private readonly pool;
    private readonly observer;
    private readonly metaAgent?;
    private agents;
    private models;
    private readonly replanManager;
    private readonly config;
    readonly strategy: IScheduleStrategy;
    readonly loopDriver: ILoopDriver;
    readonly executionModel: IExecutionModel;
    modelRouter: IModelRouter;
    /** 当前运行会话标识——executeAll() 启动时生成 */
    private _sessionId?;
    /** MemoryStore 引用——用于 beginSession/endSession 生命周期管理 */
    private _memoryStore?;
    constructor(board: ITaskBoard, pool: ISchedulerAgentPool, observer: IPipelineObserver, metaAgent?: MetaAgent | undefined, engineConfig?: EngineConfig, schedulerConfig?: CompositeSchedulerConfig);
    /** Core-2: 替换模型路由器（供 bootstrap 注入 TaskRouter + EnvironmentAwareRouter 组合） */
    setModelRouter(router: IModelRouter): void;
    /** 注册一个 AgentRunner 及其所用模型 */
    register(agentType: string, agent: Agent, model: string): void;
    /** 注入 MemoryStore——用于 executeAll() 的 sessionId 生命周期管理 */
    setMemoryStore(memory: IMemoryStore): void;
    /** 构建 RLM 拆解用的 LLM 调用入口。从 MetaAgent 的 LlmAdapter 桥接。 */
    private _buildLlmChat;
    /**
     * 执行 TaskBoard 上全部节点。
     * 动态消费模式：只要有 pending/claimed 节点就继续拓扑排序 + 逐层并行执行。
     * 每轮执行后处理 replanQueue，MetaAgent 产出新节点仅入板不执行——
     * 由下一轮循环统一调度（"领而不执"）。
     */
    executeAll(): Promise<ExecutionReport>;
    private _dispatchNode;
    /**
     * 按顺序执行 IDispatchStep 数组。
     * - 非 Cleanup 步骤返回失败结果时立即终止，但仍运行 CleanupStep
     *   确保 board.complete() 落盘 + pool.destroy() 释放，防止节点卡 claimed 状态。
     * - CleanupStep 始终运行（保证池销毁 + 落盘）
     * @fix P0-1: 非 Cleanup 步骤失败后仍执行 CleanupStep，消除 double-counted 与 NodeFailed 重复发射
     */
    private _runDispatchPipeline;
    /** 单视角节点：Claim → Spawn → [SkillInjection] → Execute → Cleanup */
    private _dispatchSingle;
    /** 多视角节点：所有匹配 Agent 并行执行 Claim → Spawn → Execute → Cleanup */
    private _dispatchMulti;
}
//# sourceMappingURL=scheduler.d.ts.map