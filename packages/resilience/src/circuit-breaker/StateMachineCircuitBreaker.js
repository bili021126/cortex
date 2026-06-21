// ============================================================
// @cortex/resilience — StateMachineCircuitBreaker
//
// 基于有限状态机（FSM）的断路器实现。
//
// 显式建模三态（CLOSED / OPEN / HALF_OPEN）及其转换规则，
// 将状态转换逻辑封装在独立的状态对象中，避免 if-else 蔓延。
//
// 状态机：
//   CLOSED     ──(threshold 条件满足)──► OPEN
//   OPEN       ──(halfOpenAfterMs 超时)──► HALF_OPEN
//   HALF_OPEN  ──(试探成功 ≥ maxHalfOpenRequests)──► CLOSED
//   HALF_OPEN  ──(试探失败 1 次)──► OPEN
//
// 身份标识：
//   本实现支持两种熔断判定策略——
//   1. consecutive（连续失败计数）：连续 N 次失败后熔断
//   2. sliding-window（滑动窗口失败率）：窗口内失败率超过阈值后熔断
//
// @design 详见 DESIGN.md §5.2「CircuitBreaker 实现」
// ============================================================
import { CircuitBreakerOpenError, } from '../registry/Registry.js';
// ============================================================
// ── 三个具体状态实现 ──
// ============================================================
/**
 * CLOSED 状态 —— 正常运作。
 *
 * 转换规则：
 * - recordSuccess → 重置连续失败计数，保持 CLOSED
 * - recordFailure → 递增失败计数，检查 threshold 条件 → 可能转为 OPEN
 */
const CLOSED_STATE = {
    state: 'CLOSED',
    onRecordSuccess(breaker) {
        breaker._consecutiveFailures = 0;
        // CLOSED 下记录成功不会触发转换（连续模式）
        // 滑动窗口模式：成功后仍需检查窗口内失败率
        if (breaker._resolvedOptions.strategy === 'sliding-window' && breaker._shouldTransitionToOpen()) {
            return 'OPEN';
        }
        return 'CLOSED';
    },
    onRecordFailure(breaker) {
        // 检查熔断条件
        if (breaker._shouldTransitionToOpen()) {
            return 'OPEN';
        }
        return 'CLOSED';
    },
    onEnter(_breaker) {
        // CLOSED 进入时无需额外操作（计数器已在 reset/forceState 中重置）
    },
};
/**
 * OPEN 状态 —— 熔断开启。
 *
 * 转换规则：
 * - recordSuccess → 不合理（call 不应放行），保持 OPEN
 * - recordFailure → 不合理，保持 OPEN
 * - 时间触发：halfOpenAfterMs 到期 → call() 中检查并转为 HALF_OPEN
 */
const OPEN_STATE = {
    state: 'OPEN',
    onRecordSuccess(_breaker) {
        // OPEN 状态下不会放行正常调用，此方法不应被调用
        return 'OPEN';
    },
    onRecordFailure(_breaker) {
        // OPEN 状态下不会放行正常调用，此方法不应被调用
        return 'OPEN';
    },
    onEnter(breaker) {
        breaker._openedAt = Date.now();
        breaker._consecutiveFailures = 0;
        breaker._halfOpenSuccesses = 0;
    },
};
/**
 * HALF_OPEN 状态 —— 试探状态。
 *
 * 转换规则：
 * - recordSuccess → 递增 halfOpenSuccesses → 达到阈值则转为 CLOSED，否则保持 HALF_OPEN
 * - recordFailure → 立即转为 OPEN
 */
const HALF_OPEN_STATE = {
    state: 'HALF_OPEN',
    onRecordSuccess(breaker) {
        breaker._consecutiveFailures = 0;
        breaker._halfOpenSuccesses++;
        if (breaker._halfOpenSuccesses >= breaker._resolvedOptions.maxHalfOpenRequests) {
            return 'CLOSED';
        }
        return 'HALF_OPEN';
    },
    onRecordFailure(_breaker) {
        // HALF_OPEN 下任意一次失败都回到 OPEN
        return 'OPEN';
    },
    onEnter(breaker) {
        breaker._halfOpenSuccesses = 0;
    },
};
// ============================================================
// ── StateMachineCircuitBreaker 主类 ──
// ============================================================
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
export class StateMachineCircuitBreaker {
    /** 断路器名称（用于日志和监控） */
    name;
    // ── 内部状态 ──
    /** 当前 FSM 状态处理器 */
    _handler;
    /**
     * 熔断开启的时间戳（用于判断 halfOpenAfterMs）。
     * @internal FSM 状态对象在同一模块内访问此属性。
     */
    _openedAt = 0;
    /**
     * 连续失败计数（两种策略均会维护此值）。
     * @internal FSM 状态对象在同一模块内访问此属性。
     */
    _consecutiveFailures = 0;
    /**
     * HALF_OPEN 状态下试探成功的次数。
     * @internal FSM 状态对象在同一模块内访问此属性。
     */
    _halfOpenSuccesses = 0;
    /** 滑动窗口调用记录（仅 sliding-window 策略使用） */
    _callRecords = [];
    /**
     * 解析后的配置选项。
     * @internal FSM 状态对象在同一模块内访问此属性。
     */
    _resolvedOptions;
    /** 状态变更处理器列表 */
    _stateChangeHandlers = [];
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
    constructor(name, options) {
        this.name = name;
        this._resolvedOptions = {
            threshold: options.threshold,
            windowMs: options.windowMs,
            halfOpenAfterMs: options.halfOpenAfterMs,
            maxHalfOpenRequests: options.maxHalfOpenRequests ?? 1,
            minimumCalls: options.minimumCalls ?? (options.strategy === 'sliding-window' ? 10 : 1),
            strategy: options.strategy ?? 'consecutive',
        };
        this._handler = CLOSED_STATE;
    }
    // ────────────────────────────────────────
    // 公开属性
    // ────────────────────────────────────────
    /** 当前断路器状态 */
    get state() {
        return this._handler.state;
    }
    // ────────────────────────────────────────
    // ICircuitBreaker 接口实现
    // ────────────────────────────────────────
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
    async call(fn, fallback) {
        // ── 1. OPEN 状态处理：半开转换检查 + 快速失败 / 降级 ──
        if (this._handler === OPEN_STATE) {
            return await this._handleOpenCall(fn, fallback);
        }
        // ── 2. CLOSED / HALF_OPEN：放行调用 ──
        try {
            const result = await fn();
            // fn 成功 → 记录成功
            this._recordSuccess();
            return result;
        }
        catch (err) {
            // fn 失败 → 记录失败
            this._recordFailure();
            // 尝试降级
            if (fallback) {
                return await fallback();
            }
            throw err;
        }
    }
    /**
     * 手动记录一次成功。
     *
     * 用于非 call 包装的场景（如手动上报外部观测到的成功结果）。
     * 会触发状态转换判断。
     */
    recordSuccess() {
        this._evictExpiredRecords();
        if (this._resolvedOptions.strategy === 'sliding-window') {
            this._callRecords.push({ timestamp: Date.now(), success: true });
        }
        const newState = this._handler.onRecordSuccess(this);
        if (newState !== this._handler.state) {
            this._transitionTo(newState);
        }
    }
    /**
     * 手动记录一次失败。
     *
     * 用于非 call 包装的场景（如手动上报外部观测到的失败结果）。
     * 会触发状态转换判断。
     */
    recordFailure() {
        this._evictExpiredRecords();
        if (this._resolvedOptions.strategy === 'sliding-window') {
            this._callRecords.push({ timestamp: Date.now(), success: false });
        }
        this._consecutiveFailures++;
        const newState = this._handler.onRecordFailure(this);
        if (newState !== this._handler.state) {
            this._transitionTo(newState);
        }
    }
    /**
     * 重置断路器到 CLOSED 状态。
     *
     * 清除所有调用记录、连续失败计数和半开成功计数。
     * 适用于测试恢复或运维手动恢复。
     */
    reset() {
        this._consecutiveFailures = 0;
        this._halfOpenSuccesses = 0;
        this._openedAt = 0;
        this._callRecords.length = 0;
        this._transitionTo('CLOSED');
    }
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
    forceState(state) {
        switch (state) {
            case 'CLOSED':
                this._consecutiveFailures = 0;
                this._halfOpenSuccesses = 0;
                this._openedAt = 0;
                this._callRecords.length = 0;
                break;
            case 'OPEN':
                this._consecutiveFailures = 0;
                this._halfOpenSuccesses = 0;
                this._openedAt = Date.now();
                this._callRecords.length = 0;
                break;
            case 'HALF_OPEN':
                // 进入 HALF_OPEN 不重置连续失败计数
                this._halfOpenSuccesses = 0;
                break;
        }
        this._transitionTo(state);
    }
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
    onStateChange(handler) {
        this._stateChangeHandlers.push(handler);
    }
    // ────────────────────────────────────────
    // 内部方法
    // ────────────────────────────────────────
    /**
     * 处理 OPEN 状态下的调用。
     *
     * 检查 halfOpenAfterMs 是否已超时：
     * - 超时 → 切换到 HALF_OPEN 并重新执行 call（递归一次）
     * - 未超时 → 执行 fallback 或抛出 CircuitBreakerOpenError
     */
    async _handleOpenCall(fn, fallback) {
        // 检查是否应进入半开试探
        if (Date.now() - this._openedAt >= this._resolvedOptions.halfOpenAfterMs) {
            this._transitionTo('HALF_OPEN');
            // 状态已变为 HALF_OPEN，重新调用（递归但只有一次）
            return await this.call(fn, fallback);
        }
        // 仍处于熔断状态
        if (fallback) {
            return await fallback();
        }
        throw new CircuitBreakerOpenError(this.name);
    }
    /**
     * 内部记录成功（含滑动窗口记录 + 状态转换）。
     */
    _recordSuccess() {
        this._evictExpiredRecords();
        if (this._resolvedOptions.strategy === 'sliding-window') {
            this._callRecords.push({ timestamp: Date.now(), success: true });
        }
        this._consecutiveFailures = 0;
        const newState = this._handler.onRecordSuccess(this);
        if (newState !== this._handler.state) {
            this._transitionTo(newState);
        }
    }
    /**
     * 内部记录失败（含滑动窗口记录 + 状态转换）。
     */
    _recordFailure() {
        this._evictExpiredRecords();
        if (this._resolvedOptions.strategy === 'sliding-window') {
            this._callRecords.push({ timestamp: Date.now(), success: false });
        }
        this._consecutiveFailures++;
        const newState = this._handler.onRecordFailure(this);
        if (newState !== this._handler.state) {
            this._transitionTo(newState);
        }
    }
    /**
     * 判断是否应从 CLOSED 切换到 OPEN。
     *
     * 根据策略不同：
     * - consecutive：连续失败次数 >= threshold
     * - sliding-window：窗口内失败率 >= threshold（且调用数 >= minimumCalls）
     *
     * @internal FSM 状态对象（CLOSED_STATE）在同一模块内访问此方法。
     */
    _shouldTransitionToOpen() {
        if (this._resolvedOptions.strategy === 'consecutive') {
            return this._consecutiveFailures >= this._resolvedOptions.threshold;
        }
        // sliding-window 策略
        const total = this._callRecords.length;
        if (total < this._resolvedOptions.minimumCalls) {
            return false; // 调用量不足，不触发熔断
        }
        const failed = this._callRecords.filter(r => !r.success).length;
        const failureRate = failed / total;
        return failureRate >= this._resolvedOptions.threshold;
    }
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
    _transitionTo(newState) {
        const previous = this._handler.state;
        if (previous === newState) {
            return;
        }
        // 查找新状态对应的 handler
        let newHandler;
        switch (newState) {
            case 'CLOSED':
                newHandler = CLOSED_STATE;
                break;
            case 'OPEN':
                newHandler = OPEN_STATE;
                break;
            case 'HALF_OPEN':
                newHandler = HALF_OPEN_STATE;
                break;
        }
        this._handler = newHandler;
        // 调用新状态的进入钩子
        newHandler.onEnter(this);
        // 通知所有监听器（异常隔离）
        for (const handler of this._stateChangeHandlers) {
            try {
                handler(newState, previous);
            }
            catch {
                // 单个监听器的异常不影响其他监听器
            }
        }
    }
    /**
     * 淘汰过期调用记录。
     *
     * 仅 sliding-window 策略有效。
     * 移出所有超出 windowMs 时间窗口的旧记录。
     */
    _evictExpiredRecords() {
        if (this._resolvedOptions.strategy !== 'sliding-window') {
            return;
        }
        const cutoff = Date.now() - this._resolvedOptions.windowMs;
        while (this._callRecords.length > 0) {
            const first = this._callRecords[0];
            if (first !== undefined && first.timestamp < cutoff) {
                this._callRecords.shift();
            }
            else {
                break;
            }
        }
    }
}
//# sourceMappingURL=StateMachineCircuitBreaker.js.map