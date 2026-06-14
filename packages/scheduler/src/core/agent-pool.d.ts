import { AgentStatus, type AgentConfig, type AgentType, type IPipelineObserver, type InvariantReporter } from "@cortex/shared";
/**
 * ISchedulerAgentPool —— Scheduler 依赖的 AgentPool 最小契约。
 * 提取此接口使 Scheduler 不依赖具体 AgentPool 实现，
 * 允许 CLI 侧 MiniAgentPool 在轻量模式下替代完整 AgentPool。
 */
export interface ISchedulerAgentPool {
    spawn(agentType: AgentType, instanceId: string): boolean;
    /** RLM 子任务——不占主配额 */
    spawnSubtask(agentType: AgentType, instanceId: string): boolean;
    getStatus(instanceId: string): AgentStatus | undefined;
    setStatus(instanceId: string, status: AgentStatus): boolean;
    destroy(agentType: AgentType, instanceId: string): void;
}
/**
 * IAgentPool —— AgentPool 完整管理接口。
 * 扩展 ISchedulerAgentPool（Scheduler 最小依赖），补全管理端方法。
 */
export interface IAgentPool extends ISchedulerAgentPool {
    register(config: AgentConfig): void;
    /** 动态调整 AgentType 最大并发数（热扩容/缩容） */
    setMaxInstances(agentType: AgentType, newMax: number): void;
    setObserver(observer: IPipelineObserver): void;
    getStatuses(agentType: AgentType): AgentStatus[];
    hasAwake(agentType: AgentType): boolean;
    canSpawn(agentType: AgentType): boolean;
    count(agentType: AgentType): number;
}
/**
 * AgentPool —— Agent 生命周期管理 + 状态机追踪
 * 每种 Agent 类型保留至少 1 个实例配额，防饥饿。
 * 状态流转：Created → Awake → Active → Awake → ... → Draining → Destroyed
 *
 * 方案B：AgentPool 为 Agent 状态的唯一权威源。
 * Agent.status 改为只读 getter，委托到 Pool；写路径仅通过 Pool.setStatus()。
 */
export declare class AgentPool implements IAgentPool {
    private configs;
    private active;
    private statuses;
    private _observer?;
    /**
     * invariant 违规上报后端。
     * 默认为 `null`（末尾兜底 console.error）。
     * 在 bootstrap 中注入 observer.emit 后，所有状态机违规会走 observer 管道。
     *
     * 优先级：实例 _observer > 静态 onInvariant > console.error
     */
    static onInvariant: InvariantReporter | null;
    /** 注入 PipelineObserver（与 onInvariant 互补的双通道模式） */
    setObserver(observer: IPipelineObserver): void;
    /** 合法状态流转表
     *  Active → Active 允许作为无操作：调度器可能对同一实例并发分发任务，
     *  已激活的 agent 再次执行时无需变更状态，静默通过即可。 */
    static readonly VALID_TRANSITIONS: Record<AgentStatus, Set<AgentStatus>>;
    register(config: AgentConfig): void;
    /**
     * 动态更新 AgentType 的最大并发数（热扩容/缩容）。
     * 同步更新本地 configs 和 ManifoldGate 流控上限。
     */
    setMaxInstances(agentType: AgentType, newMax: number): void;
    /** 启动一个 Agent 实例。超限返回 false。新实例初始状态为 Created。 */
    spawn(agentType: AgentType, instanceId: string): boolean;
    /**
     * 生成 RLM 子任务实例——不占主配额，不计入 maxInstances。
     * 子任务与父任务共享同一 Agent 类型，但不应受池子限制。
     * 使用场景：MetaAgent replan 产生的子任务、RLM ExecuteStep 拆解的 SubTask。
     */
    spawnSubtask(agentType: AgentType, instanceId: string): boolean;
    /** 更新实例状态（含流转合法性校验）。成功返回 true，非法流转返回 false。 */
    setStatus(instanceId: string, status: AgentStatus): boolean;
    /** 获取某类型下所有实例的状态列表 */
    getStatuses(agentType: AgentType): AgentStatus[];
    /** 获取单个实例的状态 */
    getStatus(instanceId: string): AgentStatus | undefined;
    /** 检查某类型是否有 Awake 状态的实例 */
    hasAwake(agentType: AgentType): boolean;
    /** 回收 Agent 实例 */
    destroy(agentType: AgentType, instanceId: string): void;
    /** 某类型还有可用配额？ */
    canSpawn(agentType: AgentType): boolean;
    /** 某类型当前实例数 */
    count(agentType: AgentType): number;
    /**
     * 统一 invariant 上报通道。
     * 优先级：_observer > onInvariant > console.error
     * 单通道收敛，消除双路径重复 emit 风险。
     */
    private _reportInvariant;
}
//# sourceMappingURL=agent-pool.d.ts.map