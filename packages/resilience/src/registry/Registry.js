import { hasAsyncLocalStorage, toError, sleep } from '../utils.js';
// ============================================================
// ── 错误类型 ──
// ============================================================
/**
 * CircuitBreakerOpenError —— 断路器熔断时抛出的错误。
 */
export class CircuitBreakerOpenError extends Error {
    circuitName;
    state;
    constructor(circuitName) {
        super(`Circuit breaker "${circuitName}" is OPEN`);
        this.name = 'CircuitBreakerOpenError';
        this.circuitName = circuitName;
        this.state = 'OPEN';
    }
}
/**
 * TimeoutError —— 超时错误。
 */
export class TimeoutError extends Error {
    timeoutMs;
    elapsedMs;
    constructor(timeoutMs, elapsedMs) {
        super(`Operation timed out after ${timeoutMs}ms`);
        this.name = 'TimeoutError';
        this.timeoutMs = timeoutMs;
        this.elapsedMs = elapsedMs;
    }
}
// ============================================================
// ── Null Object 策略（占位实现） ──
// ============================================================
/** 不重试策略 —— 用于显式关闭重试或作为默认初始值 */
class NoRetry {
    name = 'no-retry';
    maxAttempts = 1;
    nextDelay(_attempt, _error) {
        return 0;
    }
    shouldRetry(_attempt, _error) {
        return false;
    }
    reset() {
        // 无状态，无需重置
    }
}
/** 不熔断策略 —— 用于显式关闭断路器保护 */
class NoBreaker {
    name = 'no-breaker';
    state = 'CLOSED';
    async call(fn, _fallback) {
        return await fn();
    }
    recordSuccess() {
        // 无操作
    }
    recordFailure() {
        // 无操作
    }
    reset() {
        // 无操作
    }
    forceState(_state) {
        // 无操作
    }
    onStateChange(_handler) {
        // 无操作
    }
}
/** 不超时策略 —— 用于显式关闭超时保护 */
class NoTimeout {
    name = 'no-timeout';
    timeoutMs = Infinity;
    async execute(fn, _signal) {
        const startedAt = Date.now();
        try {
            const value = await fn();
            return { success: true, value, elapsedMs: Date.now() - startedAt };
        }
        catch (err) {
            return { success: false, error: toError(err), elapsedMs: Date.now() - startedAt };
        }
    }
    reset() {
        // 无状态，无需重置
    }
}
/**
 * ResilienceContextManager —— 上下文管理器（基于 AsyncLocalStorage）。
 *
 * 确保同一链路共享同一上下文，无需显式传递。
 * 在 Node.js 环境中使用 AsyncLocalStorage 实现异步上下文传播。
 */
export class ResilienceContextManager {
    static _storage = (() => {
        if (!hasAsyncLocalStorage())
            return null;
        const ALS = globalThis.AsyncLocalStorage;
        return typeof ALS === 'function' ? new ALS() : null;
    })();
    /**
     * 在上下文中执行异步函数。
     * 自动生成 executionId 并注入上下文。
     */
    static async run(policyName, fn) {
        const context = {
            executionId: ResilienceContextManager._generateId(),
            policyName,
            policyChain: [policyName],
            startedAt: Date.now(),
            attempt: 0,
            metadata: new Map(),
        };
        if (this._storage) {
            return await this._storage.run(context, () => fn(context));
        }
        // 降级：无 AsyncLocalStorage 时直接执行
        return await fn(context);
    }
    /** 获取当前上下文 */
    static current() {
        return this._storage?.getStore();
    }
    /** 生成全局唯一执行 ID */
    static _generateId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 10);
        return `${timestamp}-${random}`;
    }
}
// ============================================================
// ── Registry 类 —— 韧性策略注册中心实现 ──
// ============================================================
/**
 * Registry —— 韧性策略注册中心。
 *
 * 管理重试、断路器、超时三类策略的注册与组合执行。
 * 是 @cortex/resilience 的核心编排组件。
 *
 * @example
 * ```typescript
 * const registry = new Registry();
 *
 * // 注册 LLM API 策略组
 * registry.register('llm-api', {
 *   retry: new ExponentialBackoffRetry({ maxAttempts: 3, baseDelayMs: 1000 }),
 *   circuitBreaker: new SlidingWindowBreaker('llm-api', {
 *     threshold: 0.5, windowMs: 60000, halfOpenAfterMs: 30000,
 *   }),
 *   timeout: new FixedTimeoutPolicy({ durationMs: 30000 }),
 * });
 *
 * // 组合执行
 * const result = await registry.execute('llm-api', () => llm.chat(prompt));
 *
 * // 监听事件
 * registry.onEvent(event => {
 *   if (event.type === 'CIRCUIT_OPEN') console.warn(`⚠️ ${event.name} opened!`);
 * });
 * ```
 */
export class Registry {
    /** 内部策略存储 */
    _store = new Map();
    /** 事件处理器列表 */
    _eventHandlers = [];
    // ── 默认策略实例（复用，避免重复分配） ──
    static _defaultNoRetry = new NoRetry();
    static _defaultNoBreaker = new NoBreaker();
    static _defaultNoTimeout = new NoTimeout();
    /**
     * 创建带默认策略的 Registry 实例。
     *
     * @param defaults 可选默认策略，注册为 'default' 名称
     * @returns 新的 Registry 实例
     *
     * @example
     * ```typescript
     * const registry = Registry.create({
     *   timeout: new FixedTimeoutPolicy({ durationMs: 15000 }),
     * });
     * ```
     */
    static create(defaults) {
        const registry = new Registry();
        if (defaults) {
            registry._store.set('default', {
                retry: defaults.retry ?? Registry._defaultNoRetry,
                circuitBreaker: defaults.circuitBreaker ?? Registry._defaultNoBreaker,
                timeout: defaults.timeout ?? Registry._defaultNoTimeout,
            });
        }
        return registry;
    }
    // ────────────────────────────────────────
    // 注册与查询
    // ────────────────────────────────────────
    register(name, policies) {
        if (this._store.has(name)) {
            this._emit({ type: 'REGISTRY_OVERWRITE', name });
        }
        const existing = this._store.get(name);
        this._store.set(name, {
            retry: policies.retry ?? existing?.retry ?? Registry._defaultNoRetry,
            circuitBreaker: policies.circuitBreaker ?? existing?.circuitBreaker ?? Registry._defaultNoBreaker,
            timeout: policies.timeout ?? existing?.timeout ?? Registry._defaultNoTimeout,
        });
    }
    unregister(name) {
        this._store.delete(name);
    }
    getRetry(name) {
        return this._store.get(name)?.retry;
    }
    getCircuitBreaker(name) {
        return this._store.get(name)?.circuitBreaker;
    }
    getTimeout(name) {
        return this._store.get(name)?.timeout;
    }
    // ────────────────────────────────────────
    // 组合执行
    // ────────────────────────────────────────
    /**
     * 在指定策略保护下执行函数。
     *
     * 执行嵌套顺序（由外到内）：
     *   ResilienceContextManager → timeout → circuitBreaker → retry → fn
     *
     * 此顺序确保：
     * - 超时切断总执行时长
     * - 断路器在重试耗尽后跳闸
     * - 重试在断路器闭合时正常工作
     *
     * @param name 注册的策略组名称
     * @param fn 要执行的异步函数
     * @param overrides 可选覆盖配置（临时替换，不影响注册表）
     * @returns 执行结果
     * @throws {Error} 当未找到策略组时抛出
     * @throws {TimeoutError} 超时时抛出
     * @throws {CircuitBreakerOpenError} 断路器熔断时抛出
     */
    async execute(name, fn, overrides) {
        const policies = this._store.get(name);
        if (!policies) {
            throw new Error(`No resilience policies registered for "${name}". ` +
                `Call registry.register('${name}', ...) first.`);
        }
        const retry = overrides?.retry ?? policies.retry;
        const cb = overrides?.circuitBreaker ?? policies.circuitBreaker;
        const timeout = overrides?.timeout ?? policies.timeout;
        return await ResilienceContextManager.run(name, async (ctx) => {
            const wrapped = async () => {
                return await this._executeWithRetry(name, retry, cb, timeout, fn, ctx);
            };
            try {
                return await wrapped();
            }
            catch (err) {
                this._emit({ type: 'EXECUTION_ERROR', name, error: err instanceof Error ? err : new Error(String(err)) });
                throw err;
            }
        });
    }
    /**
     * 带重试保护的执行。
     * 内部递归：每次失败后判断是否应重试，重试时等待 nextDelay。
     */
    async _executeWithRetry(name, retry, cb, timeout, fn, ctx) {
        let lastError;
        for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
            ctx.attempt = attempt;
            try {
                // 嵌套：断路器 -> 超时 -> fn
                return await cb.call(async () => {
                    const timeoutResult = await timeout.execute(async (_signal) => await fn());
                    if (!timeoutResult.success) {
                        throw timeoutResult.error;
                    }
                    return timeoutResult.value;
                }, 
                // 熔断降级：尝试执行超时保护下的调用
                async () => {
                    const timeoutResult = await timeout.execute(async (_signal) => await fn());
                    if (!timeoutResult.success) {
                        throw timeoutResult.error;
                    }
                    return timeoutResult.value;
                });
            }
            catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                // 断路器已熔断，不再重试
                if (err instanceof CircuitBreakerOpenError) {
                    throw err;
                }
                // 超时不重试
                if (err instanceof TimeoutError) {
                    this._emit({ type: 'TIMEOUT_OCCURRED', name, timeoutMs: timeout.timeoutMs, elapsedMs: err.elapsedMs });
                    throw err;
                }
                // 判断是否应继续重试
                if (!retry.shouldRetry(attempt, err)) {
                    if (attempt >= retry.maxAttempts) {
                        this._emit({ type: 'RETRY_EXHAUSTED', name, attempt });
                    }
                    throw lastError;
                }
                // 等待后重试
                const delayMs = retry.nextDelay(attempt, err);
                if (delayMs <= 0) {
                    this._emit({ type: 'RETRY_EXHAUSTED', name, attempt });
                    throw lastError;
                }
                this._emit({ type: 'RETRY_ATTEMPT', name, attempt, delayMs });
                await sleep(delayMs);
            }
        }
        // 不应到达这里，但 TypeScript 需要返回值
        throw lastError ?? new Error(`Execution failed for "${name}"`);
    }
    // ────────────────────────────────────────
    // 快照、重置与事件
    // ────────────────────────────────────────
    /**
     * 获取所有已注册策略的快照。
     *
     * @returns 策略快照数组
     *
     * @example
     * ```typescript
     * const snapshot = registry.snapshot();
     * // [
     * //   { name: 'llm-api', retry: 'exponential-backoff',
     * //     circuitBreaker: { name: 'sliding-window', state: 'CLOSED' },
     * //     timeout: 'fixed-timeout' },
     * // ]
     * ```
     */
    snapshot() {
        const result = [];
        for (const [name, policies] of this._store) {
            result.push({
                name,
                retry: policies.retry.name,
                circuitBreaker: {
                    name: policies.circuitBreaker.name,
                    state: policies.circuitBreaker.state,
                },
                timeout: policies.timeout.name,
            });
        }
        return result;
    }
    /**
     * 全局重置所有策略到初始状态。
     * 遍历所有已注册策略，依次调用其 reset() 方法。
     */
    reset() {
        for (const [, policies] of this._store) {
            policies.retry.reset();
            policies.circuitBreaker.reset();
            policies.timeout.reset();
        }
    }
    /**
     * 注册全局状态变更监听器。
     *
     * @param handler 事件处理函数
     *
     * @example
     * ```typescript
     * registry.onEvent(event => {
     *   switch (event.type) {
     *     case 'CIRCUIT_OPEN':
     *       logger.warn(`断路器 ${event.name} 已熔断`);
     *       break;
     *     case 'RETRY_ATTEMPT':
     *       logger.debug(`重试 ${event.attempt}，等待 ${event.delayMs}ms`);
     *       break;
     *   }
     * });
     * ```
     */
    onEvent(handler) {
        this._eventHandlers.push(handler);
    }
    // ────────────────────────────────────────
    // 内部工具方法
    // ────────────────────────────────────────
    /**
     * 向所有注册的事件处理器发射事件。
     * 单个处理器的异常不会影响其他处理器（异常隔离）。
     */
    _emit(event) {
        for (const handler of this._eventHandlers) {
            try {
                handler(event);
            }
            catch {
                // 事件处理器异常隔离 —— 不中断其他处理器
            }
        }
    }
}
//# sourceMappingURL=Registry.js.map