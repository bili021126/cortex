import { type AgentStatus, type SafeErrorReporter } from "@cortex/shared";
import { type AgentPool } from "@cortex/scheduler";
export declare class PoolAwareState {
    private _localStatus;
    private _pool;
    private _instanceId;
    private _safeReporter;
    /** 延迟求值的标签提供者——解决 abstract property 在基类构造器中未就绪的问题 */
    private readonly _tagProvider;
    /**
     * @param tagOrProvider 标签字符串或延迟求值函数。
     *   使用 `() => this.type` 可避免 abstract property 初始化顺序问题。
     */
    constructor(tagOrProvider?: string | (() => string));
    /** @fix M7 — tagProvider 抛异常时通过 safeReporter 上报，不再吞没为 "Agent"。
     * @fix FG-6 — 增加 try/catch fallback：异常时 fallback 到 "Agent" 并通过 _safeReporter 上报，
     *   避免异常直接传播到 transition() 的消息构造层导致上报本身也失败。 */
    private get _tag();
    /** 方案B：status 只读 getter —— Pool 有则委托，否则降级到 _localStatus */
    get status(): AgentStatus;
    /** 注入 AgentPool 引用（方案B：状态所有权归一）。
     *  同步 Pool 初始状态：Agent 已被 wakeup() 唤醒至 Awake，
     *  但 Pool.spawn() 初始为 Created，需将 Pool 推进到当前本地状态。 */
    setPool(pool: AgentPool, instanceId: string): void;
    /** 注入 SafeErrorReporter（由 bootstrap 在上层统一注入） */
    setSafeReporter(reporter: SafeErrorReporter): void;
    /**
     * 状态流转。
     * 有 Pool：走 Pool 唯一权威源（含 VALID_TRANSITIONS 校验）。
     * 无 Pool：走本地校验（与 Pool 同源流转表），拒绝非法流转。
     *
     * @returns true 表示流转成功；false 表示流转被拒绝（已上报）。
     */
    transition(status: AgentStatus): boolean;
}
//# sourceMappingURL=pool-aware.d.ts.map