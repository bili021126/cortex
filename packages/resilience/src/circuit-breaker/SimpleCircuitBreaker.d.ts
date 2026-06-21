import { type ICircuitBreaker, type CircuitState } from '../registry/Registry.js';
/**
 * SimpleCircuitBreakerOptions —— 简单开关断路器的配置选项。
 */
export interface SimpleCircuitBreakerOptions {
    /**
     * 连续失败阈值，达到此值时断路器从 CLOSED 转为 OPEN。
     * 必须 >= 1。
     * @default 5
     */
    threshold?: number;
    /**
     * 断路器熔断后，经过此毫秒数后进入 HALF_OPEN 试探状态。
     * 必须 >= 0。
     * @default 30000 (30 秒)
     */
    halfOpenAfterMs?: number;
    /**
     * 断路器名称，用于日志和监控。
     */
    name: string;
}
/**
 * SimpleCircuitBreaker —— 简单开关断路器。
 *
 * 基于连续失败次数的三态断路器实现。
 * 相比滑动窗口断路器，实现更轻量，适合对短暂故障敏感的场景。
 *
 * 状态机：
 * ```
 *   CLOSED ──(连续失败 >= threshold)──→ OPEN
 *   OPEN   ──(halfOpenAfterMs 超时)──→ HALF_OPEN
 *   HALF_OPEN ──(成功)──→ CLOSED
 *   HALF_OPEN ──(失败)──→ OPEN
 * ```
 *
 * @example
 * ```typescript
 * const breaker = new SimpleCircuitBreaker({
 *   name: 'llm-api',
 *   threshold: 3,
 *   halfOpenAfterMs: 10000,
 * });
 *
 * // 在断路器保护下执行
 * const result = await breaker.call(
 *   () => fetch('https://api.example.com'),
 *   () => Promise.resolve('fallback result'),
 * );
 *
 * // 监听状态变更
 * breaker.onStateChange((state, previous) => {
 *   console.log(`Circuit: ${previous} → ${state}`);
 * });
 *
 * // 手动重置
 * breaker.reset();
 * ```
 *
 * @implements {ICircuitBreaker}
 */
export declare class SimpleCircuitBreaker implements ICircuitBreaker {
    /** 断路器名称 */
    readonly name: string;
    /** 当前内部状态 */
    private _state;
    /** 连续失败计数器 */
    private _consecutiveFailures;
    /** 进入 OPEN 状态的时间戳（毫秒） */
    private _openedAt;
    /** 状态变更事件处理器列表 */
    private readonly _handlers;
    /** 连续失败阈值 */
    private readonly _threshold;
    /** 熔断后到半开的等待时间（毫秒） */
    private readonly _halfOpenAfterMs;
    /**
     * 创建一个 SimpleCircuitBreaker 实例。
     *
     * @param options 配置选项
     *
     * @throws {RangeError} 当 threshold < 1 或 halfOpenAfterMs < 0 时抛出
     */
    constructor(options: SimpleCircuitBreakerOptions);
    /** 当前断路器状态 */
    get state(): CircuitState;
    /**
     * 当前连续失败次数（只读）。
     * 用于监控和调试。
     */
    get consecutiveFailures(): number;
    /**
     * 在断路器保护下执行异步调用。
     *
     * 执行逻辑取决于当前状态：
     * - **CLOSED**: 放行调用，根据结果记录成功/失败
     * - **OPEN**: 检查是否达到半开等待时间，若未达到则快速失败（或执行降级）
     * - **HALF_OPEN**: 放行单一试探请求，成功则闭合，失败则熔断
     *
     * @param fn 被保护的异步函数
     * @param fallback 可选降级函数，熔断时调用
     * @returns 执行结果或降级结果
     *
     * @throws {CircuitBreakerOpenError} 当断路器处于 OPEN 状态且未提供 fallback 时抛出
     */
    call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T>;
    /**
     * 手动记录一次成功。
     *
     * 效果：
     * - 清零连续失败计数器
     * - 若当前为 HALF_OPEN，转为 CLOSED
     */
    recordSuccess(): void;
    /**
     * 手动记录一次失败。
     *
     * 效果：
     * - 连续失败计数器 +1
     * - 若当前为 HALF_OPEN，转为 OPEN
     * - 若当前为 CLOSED 且连续失败达到阈值，转为 OPEN
     */
    recordFailure(): void;
    /**
     * 重置断路器到 CLOSED 状态。
     *
     * 清零连续失败计数器，清空所有内部状态。
     * 适用于：
     * - 手动恢复
     * - 周期性健康检查后重置
     * - 测试用例重置
     */
    reset(): void;
    /**
     * 强制转换到指定状态（测试/运维用）。
     *
     * 注意事项：
     * - 强制转换为 CLOSED 时：清零连续失败计数器
     * - 强制转换为 OPEN 时：设置熔断时间戳为当前时间
     * - 强制转换为 HALF_OPEN 时：保持当前连续失败计数不变
     *
     * @param state 目标状态
     */
    forceState(state: CircuitState): void;
    /**
     * 订阅状态变更事件。
     *
     * @param handler 状态变更处理函数，接收新状态和旧状态
     *
     * @example
     * ```typescript
     * breaker.onStateChange((state, previous) => {
     *   logger.info(`断路器状态变更: ${previous} → ${state}`);
     * });
     * ```
     */
    onStateChange(handler: (state: CircuitState, previous: CircuitState) => void): void;
    /**
     * 执行状态转换并通知所有已注册的事件处理器。
     *
     * 状态转换守卫：
     * - 如果目标状态与当前状态相同，不进行转换
     * - 转换后会触发所有 onStateChange 回调
     * - 单个处理器的异常不会影响其他处理器（异常隔离）
     *
     * @param newState 目标状态
     */
    private _transitionTo;
}
//# sourceMappingURL=SimpleCircuitBreaker.d.ts.map