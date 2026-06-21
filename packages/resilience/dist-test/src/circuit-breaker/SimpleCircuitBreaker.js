// ============================================================
// @cortex/resilience — SimpleCircuitBreaker 简单开关断路器
//
// @file-overview
// SimpleCircuitBreaker 是基于连续失败次数的轻量断路器实现。
// 核心逻辑是简单的开关三态机：CLOSED → OPEN → HALF_OPEN → CLOSED | OPEN。
//
// 特性：
// - 连续失败计数熔断（无滑动窗口，开销极低）
// - 半开期单一试探请求（首个成功即闭合，首个失败即熔断）
// - 状态变更事件通知
// - 强制状态转换（测试/运维用）
//
// @design 详见 DESIGN.md §5.2.2「ConsecutiveFailureBreaker」
// ============================================================
import { CircuitBreakerOpenError, } from '../registry/Registry.js';
// ============================================================
// ── SimpleCircuitBreaker ──
// ============================================================
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
export class SimpleCircuitBreaker {
    /** 断路器名称 */
    name;
    /** 当前内部状态 */
    _state = 'CLOSED';
    /** 连续失败计数器 */
    _consecutiveFailures = 0;
    /** 进入 OPEN 状态的时间戳（毫秒） */
    _openedAt = 0;
    /** 状态变更事件处理器列表 */
    _handlers = [];
    /** 连续失败阈值 */
    _threshold;
    /** 熔断后到半开的等待时间（毫秒） */
    _halfOpenAfterMs;
    /**
     * 创建一个 SimpleCircuitBreaker 实例。
     *
     * @param options 配置选项
     *
     * @throws {RangeError} 当 threshold < 1 或 halfOpenAfterMs < 0 时抛出
     */
    constructor(options) {
        const threshold = options.threshold ?? 5;
        const halfOpenAfterMs = options.halfOpenAfterMs ?? 30_000;
        if (threshold < 1) {
            throw new RangeError(`SimpleCircuitBreaker threshold must be >= 1, got ${threshold}`);
        }
        if (halfOpenAfterMs < 0) {
            throw new RangeError(`SimpleCircuitBreaker halfOpenAfterMs must be >= 0, got ${halfOpenAfterMs}`);
        }
        this.name = options.name;
        this._threshold = threshold;
        this._halfOpenAfterMs = halfOpenAfterMs;
    }
    // ────────────────────────────────────────
    // 公开属性
    // ────────────────────────────────────────
    /** 当前断路器状态 */
    get state() {
        return this._state;
    }
    /**
     * 当前连续失败次数（只读）。
     * 用于监控和调试。
     */
    get consecutiveFailures() {
        return this._consecutiveFailures;
    }
    // ────────────────────────────────────────
    // ICircuitBreaker 接口实现
    // ────────────────────────────────────────
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
    async call(fn, fallback) {
        // ── 状态预检 ──
        if (this._state === 'OPEN') {
            // 检查是否应进入 HALF_OPEN
            if (Date.now() - this._openedAt >= this._halfOpenAfterMs) {
                this._transitionTo('HALF_OPEN');
            }
            else {
                // 熔断中：执行降级或快速失败
                if (fallback !== undefined) {
                    return await fallback();
                }
                throw new CircuitBreakerOpenError(this.name);
            }
        }
        // HALF_OPEN 状态下，如果先前试探请求已成功（不应发生，防御性检查）
        // 正常 HALF_OPEN 流程在 recordSuccess/recordFailure 中处理
        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        }
        catch (err) {
            this.recordFailure();
            if (fallback !== undefined) {
                return await fallback();
            }
            throw err;
        }
    }
    /**
     * 手动记录一次成功。
     *
     * 效果：
     * - 清零连续失败计数器
     * - 若当前为 HALF_OPEN，转为 CLOSED
     */
    recordSuccess() {
        this._consecutiveFailures = 0;
        if (this._state === 'HALF_OPEN') {
            this._transitionTo('CLOSED');
        }
    }
    /**
     * 手动记录一次失败。
     *
     * 效果：
     * - 连续失败计数器 +1
     * - 若当前为 HALF_OPEN，转为 OPEN
     * - 若当前为 CLOSED 且连续失败达到阈值，转为 OPEN
     */
    recordFailure() {
        this._consecutiveFailures++;
        if (this._state === 'HALF_OPEN') {
            // 半开试探失败 → 立即熔断
            this._transitionTo('OPEN');
            return;
        }
        if (this._state === 'CLOSED' && this._consecutiveFailures >= this._threshold) {
            this._transitionTo('OPEN');
        }
        // OPEN 状态下 recordFailure 仅增加计数，状态不变
    }
    /**
     * 重置断路器到 CLOSED 状态。
     *
     * 清零连续失败计数器，清空所有内部状态。
     * 适用于：
     * - 手动恢复
     * - 周期性健康检查后重置
     * - 测试用例重置
     */
    reset() {
        this._consecutiveFailures = 0;
        this._openedAt = 0;
        this._transitionTo('CLOSED');
    }
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
    forceState(state) {
        if (state === 'CLOSED') {
            this._consecutiveFailures = 0;
            this._openedAt = 0;
        }
        else if (state === 'OPEN') {
            this._openedAt = Date.now();
        }
        // HALF_OPEN: 不需要特殊处理
        this._transitionTo(state);
    }
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
    onStateChange(handler) {
        this._handlers.push(handler);
    }
    // ────────────────────────────────────────
    // 内部方法
    // ────────────────────────────────────────
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
    _transitionTo(newState) {
        if (this._state === newState) {
            return;
        }
        const previous = this._state;
        this._state = newState;
        if (newState === 'OPEN') {
            this._openedAt = Date.now();
        }
        else {
            this._openedAt = 0;
        }
        // 通知所有状态变更处理器
        for (const handler of this._handlers) {
            try {
                handler(newState, previous);
            }
            catch {
                // 事件处理器异常隔离 —— 不中断其他处理器
            }
        }
    }
}
//# sourceMappingURL=SimpleCircuitBreaker.js.map