import { type ICircuitBreaker, type CircuitState } from '../registry/Registry.js';
/**
 * CircuitBreakerOptions —— 断路器的通用配置。
 *
 * 同时支持连续失败计数和滑动窗口失败率两种熔断判定策略。
 */
export interface CircuitBreakerOptions {
    /**
     * 熔断触发阈值。
     * - 连续失败模式：连续失败次数达到此值时熔断（threshold 应为 >= 1 的整数）
     * - 滑动窗口模式：失败率达到此值时熔断（threshold 应为 0.0 ~ 1.0 的小数）
     */
    readonly threshold: number;
    /** 滑动窗口大小（毫秒）。窗口模式的有效时间范围；连续模式下设为 0 即可 */
    readonly windowMs: number;
    /** 断开后等待时间（毫秒），之后进入 HALF_OPEN 试探状态 */
    readonly halfOpenAfterMs: number;
    /** 最大半开试探请求成功数 —— 连续成功达到此值后闭合电路（默认 1） */
    readonly maxHalfOpenRequests?: number;
    /** 最小调用次数 —— 低于此值不触发熔断判定，防止冷启动过早熔断（默认 10，连续模式默认 1） */
    readonly minimumCalls?: number;
    /**
     * 熔断判定策略。
     * - 'consecutive'（默认）：基于连续失败次数
     * - 'sliding-window'：基于滑动窗口失败率
     */
    readonly strategy?: 'consecutive' | 'sliding-window';
}
/**
 * StateMachineCircuitBreaker —— 基于有限状态机的断路器实现。
 *
 * 使用显式的状态对象（FsmState）封装 CLOSED / OPEN / HALF_OPEN
 * 三态下的转换规则，避免散弹式 switch-case。
 *
 * 支持两种熔断判定策略：
 * - 'consecutive'（连续失败计数）：连续 failureCount 次失败后熔断
 * - 'sliding-window'（滑动窗口失败率）：窗口内失败率超过 threshold 时熔断
 *
 * 执行语义：
 * - call(fn, fallback) 的职责是「放行或拒绝」+「记录成功或失败」
 * - fn 成功 → recordSuccess → 可能触发状态转换
 * - fn 失败 → recordFailure → 可能触发状态转换 + 尝试 fallback
 * - 熔断时（OPEN）→ 直接执行 fallback 或抛出 CircuitBreakerOpenError
 *
 * @example
 * ```typescript
 * // 连续失败模式（默认）
 * const breaker = new StateMachineCircuitBreaker('llm-api', {
 *   threshold: 5,
 *   windowMs: 0,
 *   halfOpenAfterMs: 30000,
 *   maxHalfOpenRequests: 3,
 * });
 *
 * // 滑动窗口失败率模式
 * const breaker2 = new StateMachineCircuitBreaker('search-api', {
 *   threshold: 0.5,
 *   windowMs: 60000,
 *   halfOpenAfterMs: 30000,
 *   minimumCalls: 10,
 *   strategy: 'sliding-window',
 * });
 *
 * // 监听状态变更
 * breaker.onStateChange((state, previous) => {
 *   logger.info(`断路器 ${breaker.name}: ${previous} → ${state}`);
 * });
 *
 * // 受保护调用
 * const result = await breaker.call(
 *   () => api.fetchData(),
 *   () => cachedData,  // 熔断时降级
 * );
 * ```
 */
export declare class StateMachineCircuitBreaker implements ICircuitBreaker {
    /** 断路器名称（用于日志和监控） */
    readonly name: string;
    /** 当前 FSM 状态处理器 */
    private _handler;
    /**
     * 熔断开启的时间戳（用于判断 halfOpenAfterMs）。
     * @internal FSM 状态对象在同一模块内访问此属性。
     */
    _openedAt: number;
    /**
     * 连续失败计数（两种策略均会维护此值）。
     * @internal FSM 状态对象在同一模块内访问此属性。
     */
    _consecutiveFailures: number;
    /**
     * HALF_OPEN 状态下试探成功的次数。
     * @internal FSM 状态对象在同一模块内访问此属性。
     */
    _halfOpenSuccesses: number;
    /** 滑动窗口调用记录（仅 sliding-window 策略使用） */
    private readonly _callRecords;
    /**
     * 解析后的配置选项。
     * @internal FSM 状态对象在同一模块内访问此属性。
     */
    _resolvedOptions: Required<CircuitBreakerOptions>;
    /** 状态变更处理器列表 */
    private readonly _stateChangeHandlers;
    /**
     * @param name 断路器名称（用于日志和监控）
     * @param options 断路器配置
     *
     * @example
     * ```typescript
     * // 连续失败模式：5 次连续失败后熔断，30 秒后尝试恢复
     * const breaker = new StateMachineCircuitBreaker('llm-api', {
     *   threshold: 5,
     *   windowMs: 0,
     *   halfOpenAfterMs: 30000,
     * });
     *
     * // 滑动窗口模式：60 秒窗口内 50% 失败率触发熔断
     * const breaker2 = new StateMachineCircuitBreaker('search-api', {
     *   threshold: 0.5,
     *   windowMs: 60000,
     *   halfOpenAfterMs: 30000,
     *   minimumCalls: 10,
     *   strategy: 'sliding-window',
     * });
     * ```
     */
    constructor(name: string, options: CircuitBreakerOptions);
    /** 当前断路器状态 */
    get state(): CircuitState;
    /**
     * 在断路器保护下执行异步调用。
     *
     * ### 行为矩阵
     *
     * | 当前状态 | fn 执行 | fallback | 结果 |
     * |----------|---------|----------|------|
     * | CLOSED   | 成功    | —        | recordSuccess + 返回结果 |
     * | CLOSED   | 失败    | 有       | recordFailure + 执行 fallback + 返回降级结果 |
     * | CLOSED   | 失败    | 无       | recordFailure + 抛出异常 |
     * | OPEN     | 不执行  | 有       | 执行 fallback + 返回降级结果（不记录） |
     * | OPEN     | 不执行  | 无       | 抛出 CircuitBreakerOpenError |
     * | HALF_OPEN | 成功   | —        | recordSuccess + 可能闭合电路 |
     * | HALF_OPEN | 失败   | 有       | recordFailure + 回到 OPEN + 执行 fallback |
     * | HALF_OPEN | 失败   | 无       | recordFailure + 回到 OPEN + 抛出异常 |
     *
     * @param fn 被保护的异步函数
     * @param fallback 可选降级函数，熔断或失败时调用
     * @returns fn 或 fallback 的执行结果
     * @throws {CircuitBreakerOpenError} 断路器熔断且无 fallback 时抛出
     * @throws {Error} fn 或 fallback 抛出的原始异常
     */
    call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T>;
    /**
     * 手动记录一次成功。
     *
     * 用于非 call 包装的场景（如手动上报外部观测到的成功结果）。
     * 会触发状态转换判断。
     */
    recordSuccess(): void;
    /**
     * 手动记录一次失败。
     *
     * 用于非 call 包装的场景（如手动上报外部观测到的失败结果）。
     * 会触发状态转换判断。
     */
    recordFailure(): void;
    /**
     * 重置断路器到 CLOSED 状态。
     *
     * 清除所有调用记录、连续失败计数和半开成功计数。
     * 适用于测试恢复或运维手动恢复。
     */
    reset(): void;
    /**
     * 强制转换到指定状态（测试/运维用）。
     *
     * @param state 目标状态
     *
     * @example
     * ```typescript
     * breaker.forceState('OPEN');   // 手动熔断
     * breaker.forceState('CLOSED'); // 手动恢复
     * ```
     */
    forceState(state: CircuitState): void;
    /**
     * 订阅状态变更事件。
     *
     * @param handler 状态变更回调，接收 (newState, previousState)
     *
     * @example
     * ```typescript
     * breaker.onStateChange((state, previous) => {
     *   metrics.recordCircuitBreakerState(breaker.name, state);
     * });
     * ```
     */
    onStateChange(handler: (state: CircuitState, previous: CircuitState) => void): void;
    /**
     * 处理 OPEN 状态下的调用。
     *
     * 检查 halfOpenAfterMs 是否已超时：
     * - 超时 → 切换到 HALF_OPEN 并重新执行 call（递归一次）
     * - 未超时 → 执行 fallback 或抛出 CircuitBreakerOpenError
     */
    private _handleOpenCall;
    /**
     * 内部记录成功（含滑动窗口记录 + 状态转换）。
     */
    private _recordSuccess;
    /**
     * 内部记录失败（含滑动窗口记录 + 状态转换）。
     */
    private _recordFailure;
    /**
     * 判断是否应从 CLOSED 切换到 OPEN。
     *
     * 根据策略不同：
     * - consecutive：连续失败次数 >= threshold
     * - sliding-window：窗口内失败率 >= threshold（且调用数 >= minimumCalls）
     *
     * @internal FSM 状态对象（CLOSED_STATE）在同一模块内访问此方法。
     */
    _shouldTransitionToOpen(): boolean;
    /**
     * 执行状态转换。
     *
     * 流程：
     * 1. 若新旧状态相同，跳过（防止重复触发）
     * 2. 切换 _handler
     * 3. 调用新状态的 onEnter 钩子
     * 4. 通知所有注册的 onStateChange 监听器
     *
     * 监听器的异常被隔离，不影响主流程。
     */
    private _transitionTo;
    /**
     * 淘汰过期调用记录。
     *
     * 仅 sliding-window 策略有效。
     * 移出所有超出 windowMs 时间窗口的旧记录。
     */
    private _evictExpiredRecords;
}
//# sourceMappingURL=StateMachineCircuitBreaker.d.ts.map