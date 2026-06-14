import type { AgentType, IPipelineObserver, InvariantReporter, TaskNode } from "@cortex/shared";
/**
 * ITaskBoard —— TaskBoard 抽象接口。
 *
 * 解耦点：Scheduler 不再依赖具体 TaskBoard 类，而是通过此接口与任务板交互。
 * 方便测试 mock 和未来扩展（如分布式任务板）。
 *
 * claim/release/complete 三方法构成 Scheduler 与 TaskBoard 之间的核心协议。
 */
export interface ITaskBoard {
    addNode(node: TaskNode): void;
    claim(nodeId: string, agentType: AgentType): TaskNode | null;
    release(nodeId: string, agentType: AgentType): boolean;
    complete(nodeId: string, agentType: AgentType, success: boolean, output?: string, error?: string): void;
    failNode(nodeId: string): boolean;
    getNode(nodeId: string): TaskNode | undefined;
    getAllNodes(): TaskNode[];
    getPendingNodes(): TaskNode[];
    removeNode(nodeId: string): void;
    removeSubtree(nodeId: string): void;
}
/**
 * TaskBoard —— 任务板
 *
 * @contract 模块边界契约
 *
 * @depends  @cortex/shared（AgentType, AGENT_TAGS, TaskNode, PipelineEventType）
 * @dataflow 纯数据结构管理器：节点 Map → claim/release/complete 原子操作 → 状态转移
 *           无下游依赖——TaskBoard 是 Scheduler 的被动数据源，不主动调用外部模块
 *
 *   claim/release/complete 三方法构成 Scheduler 与 TaskBoard 之间的核心协议：
 *
 *   前置条件：
 *   - claim(): 节点存在且标签匹配，status=pending（普通）或非 done/failed（multi）
 *   - release(): status=claimed（普通）或非 done/failed 且 claimedBy 含 agentType（multi）
 *   - complete(): claimedBy 含 agentType，且 results 中同 agentType 不重复
 *
 *   后置条件：
 *   - claim() 成功：status 变为 claimed（普通）或 claimedBy 追加 agentType（multi）
 *   - release() 成功：status 回退 pending（普通），claimedBy 移除 agentType（multi）
 *   - complete() 后 status 为 done/failed（普通）或等齐全部 claimed 后 done（multi）
 *
 *   不变量：
 *   - results 中每个 agentType 必须存在于 claimedBy 中（对称性——TaskBoard.complete 检查）
 *   - done/failed 终态不可逆
 *
 * 原子 claim、标签匹配、needsMultiPerspective 多 Agent 并行认领与等齐。
 *
 * @fix D6 — invariant 上报单通道收敛：_observer 实例优先于 onInvariant 静态字段，
 *   消除重复 emit 和维护负担。
 */
export declare class TaskBoard implements ITaskBoard {
    private nodes;
    private _observer?;
    /**
     * invariant 违规上报后端。
     * 默认为 `null`（仅 console.error）。
     * 在 bootstrap 中注入 observer.emit 后，所有 invariant 违规会走 observer 管道。
     *
     * 优先级：实例 _observer > 静态 onInvariant > console.error
     */
    static onInvariant: InvariantReporter | null;
    /** 注入 PipelineObserver（与 onInvariant 互补的双通道模式） */
    setObserver(observer: IPipelineObserver): void;
    addNode(node: TaskNode): void;
    /**
     * 原子认领。
     *
     * **并发安全**：此方法是同步的（无 await），在 Node.js 单线程事件循环中
     * 天然原子。若未来引入异步检查（如标签验证），必须加互斥锁或改为状态机。
     *
     * 普通节点：仅 pending 可认领，已认领拒。
     * needsMultiPerspective：不同 Agent 类型可并行认领，同类型不可重复。
     */
    claim(nodeId: string, agentType: AgentType): TaskNode | null;
    /**
     * 释放认领。仅 claimed 态可回退到 pending。
     * running/done/failed 态拒绝释放——已开始执行的不可撤销。
     * 仅认领者本人可释放。
     *
     * multi-perspective：running 态允许释放单个 agentType（其他 Agent 继续执行），
     * 仅 done/failed 终态拒绝。防止 spawn 失败后该类型残留在 claimedBy 中导致死锁。
     */
    release(nodeId: string, agentType: AgentType): boolean;
    /**
     * 查找该 Agent 类型当前可认领的全部节点。
     * 普通节点只看 pending；multi-perspective 节点包含 running 中但该类型未认领的。
     */
    findPending(agentType: AgentType): TaskNode[];
    /**
     * Agent 产出结果。
     * needsMultiPerspective 节点：等所有匹配 Agent 类型全部产出后自动置为 done。
     * 普通节点：直接置 done/failed。
     */
    complete(nodeId: string, agentType: AgentType, success: boolean, output?: string, error?: string): void;
    /**
     * 强制标记节点为失败（无需认领，无需 agentType）。
     * 用于无匹配 Agent、无注册 Runner、状态不符等调度前错误路径。
     */
    failNode(nodeId: string): boolean;
    /** 多视角节点是否已等齐全部认领 Agent */
    allPerspectivesComplete(nodeId: string): boolean;
    getNode(nodeId: string): TaskNode | undefined;
    /** 获取全部节点 */
    getAllNodes(): TaskNode[];
    /** 获取全部 pending/claimed 节点（供 executeAll 动态消费） */
    getPendingNodes(): TaskNode[];
    /**
     * 移除单个节点，emit NodeRemoved 事件。
     */
    removeNode(nodeId: string): void;
    /**
     * 移除子树（节点及其所有子孙）。
     * 使用 BFS 遍历收集后代节点后统一删除。
     */
    removeSubtree(nodeId: string): void;
    /**
     * 取消任务节点。
     */
    cancel(nodeId: string): boolean;
    /**
     * 上报 invariant 违规。
     * 优先级：实例 _observer > 静态 onInvariant > console.error
     */
    private _reportInvariant;
}
//# sourceMappingURL=task-board.d.ts.map