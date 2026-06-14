/**
 * ManifoldGate —— mHC 流形约束门控。
 *
 * 灵感来自 DeepSeek mHC (Manifold-Constrained Hyper-Connections) 论文：
 * - 流形约束：同类型 Agent 并发数 ≤ maxInstances
 * - 恒等保持：保证节点不静默丢失——等待到超时，或优雅失败
 * - FIFO 公平：先到先服务，无饥饿
 *
 * 集成方式：
 * - SpawnStep: spawn 前 acquire(type)，失败时 release(type)
 * - CleanupStep: destroy 后 release(type)
 *
 * @since mHC-Constrained Dispatch Pipeline
 */
import type { AgentType, IPipelineObserver } from "@cortex/shared";
/**
 * ManifoldGate —— 全局单例流约束门控。
 *
 * 设计决策：使用静态 Map 而非实例，因为：
 * 1. Scheduler 单例运行期间只存在一个调度循环
 * 2. SpawnStep/CleanupStep 通过 dispatch 管道自然串行化
 * 3. 无需跨 Scheduler 实例共享状态
 */
export declare class ManifoldGate {
    private static _gates;
    private static _maxByType;
    private static _observer;
    private static _requestSeq;
    /** 生成唯一 requestId——格式 mg-{seq}-{timestamp36} */
    private static _nextRequestId;
    /**
     * 注入 PipelineObserver（用于上报流控事件）。
     */
    static setObserver(observer: IPipelineObserver): void;
    /**
     * 注册 AgentType 的最大并发数（由 AgentPool.register 同步调用）。
     * maxInstances 必须 > 0，否则降级为 1（防御性默认）。
     */
    static register(agentType: string, maxInstances: number): void;
    /**
     * 热更新 AgentType 的最大并发数。
     * 若 newMax < 当前 active，多余槽位在后续 release 时自然回收。
     */
    static updateMax(agentType: string, newMax: number): void;
    /**
     * 获取当前活跃实例数。
     */
    static active(agentType: string): number;
    /**
     * 获取等待队列长度。
     */
    static waiting(agentType: string): number;
    /**
     * 获取最大并发数。
     */
    static max(agentType: string): number;
    /**
     * 获取执行槽位。
     *
     * - 当前活跃 < maxInstances → 立即返回
     * - 当前活跃 ≥ maxInstances → FIFO 排队等待，最长等 acquireTimeoutMs
     * - 超时 → 返回 false
     */
    static acquire(agentType: AgentType | string, acquireTimeoutMs?: number): Promise<boolean>;
    /**
     * 释放执行槽位，唤醒下一个等待者（FIFO）。
     */
    static release(agentType: AgentType | string): void;
    /**
     * 重置所有门控状态（测试用）。
     */
    static reset(): void;
    /**
     * 优雅关闭指定类型的门控。
     */
    static drain(agentType: string): Promise<void>;
    private static _emitWaitStart;
    private static _emitWaitEnd;
    private static _emitWaitTimeout;
    private static _emitReleased;
    private static _emitInvariant;
    private static _emitReleaseOrphan;
    /** 上限变更事件——与 _emitReleased 对称，updateMax 扩容时发射 */
    private static _emitMaxUpdated;
}
//# sourceMappingURL=manifold-gate.d.ts.map