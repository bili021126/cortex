/** 断路器三态 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
/** 韧性事件 —— 用于全局事件监听与监控 */
export type ResilienceEvent = {
    type: 'RETRY_ATTEMPT';
    name: string;
    attempt: number;
    delayMs: number;
} | {
    type: 'RETRY_EXHAUSTED';
    name: string;
    attempt: number;
} | {
    type: 'CIRCUIT_STATE_CHANGE';
    name: string;
    from: CircuitState;
    to: CircuitState;
} | {
    type: 'CIRCUIT_OPEN';
    name: string;
} | {
    type: 'CIRCUIT_HALF_OPEN';
    name: string;
} | {
    type: 'CIRCUIT_CLOSED';
    name: string;
} | {
    type: 'TIMEOUT_OCCURRED';
    name: string;
    timeoutMs: number;
    elapsedMs: number;
} | {
    type: 'ADAPTIVE_TIMEOUT_UPDATE';
    name: string;
    newTimeoutMs: number;
} | {
    type: 'REGISTRY_OVERWRITE';
    name: string;
} | {
    type: 'EXECUTION_ERROR';
    name: string;
    error: Error;
};
/**
 * IRetryPolicy —— 重试策略接口。
 *
 * 决定「是否重试」「等待多久」「何时放弃」。
 * 不关心具体业务逻辑，只关心退避算法和终止条件。
 */
export interface IRetryPolicy {
    /** 策略名称，用于日志和监控 */
    readonly name: string;
    /** 最大尝试次数（含首次） */
    readonly maxAttempts: number;
    /**
     * 获取下一次重试前的等待时间。
     * @param attempt 当前重试次数（1-based）
     * @param error 触发重试的异常
     * @returns 等待毫秒数，返回 ≤0 表示不应重试
     */
    nextDelay(attempt: number, error?: unknown): number;
    /**
     * 判断是否应继续重试。
     * @param attempt 已执行的尝试次数
     * @param error 最近一次异常
     */
    shouldRetry(attempt: number, error?: unknown): boolean;
    /** 重置策略状态 */
    reset(): void;
}
/**
 * ICircuitBreaker —— 断路器接口。
 *
 * 保护下游依赖不被频繁失败的请求压垮。
 * 三态转换：CLOSED（正常）→ OPEN（熔断）→ HALF_OPEN（试探）→ CLOSED | OPEN。
 */
export interface ICircuitBreaker {
    /** 断路器名称 */
    readonly name: string;
    /** 当前状态 */
    readonly state: CircuitState;
    /**
     * 在断路器保护下执行异步调用。
     * @param fn 被保护的异步函数
     * @param fallback 可选降级函数，熔断时调用
     */
    call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T>;
    /** 手动记录一次成功 */
    recordSuccess(): void;
    /** 手动记录一次失败 */
    recordFailure(): void;
    /** 重置断路器到 CLOSED 状态 */
    reset(): void;
    /** 强制转换到指定状态（测试/运维用） */
    forceState(state: CircuitState): void;
    /** 订阅状态变更事件 */
    onStateChange(handler: (state: CircuitState, previous: CircuitState) => void): void;
}
/**
 * ITimeoutPolicy —— 超时策略接口。
 *
 * 为异步操作提供统一超时控制。
 */
export interface ITimeoutPolicy {
    /** 策略名称 */
    readonly name: string;
    /** 当前超时值（毫秒），可能随自适应算法变化 */
    readonly timeoutMs: number;
    /**
     * 在超时保护下执行异步函数。
     * @param fn 要执行的异步函数，接收 AbortSignal 作为可选参数
     * @param signal 外部取消信号（可选）
     */
    execute<T>(fn: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<TimeoutResult<T>>;
    /** 重置超时策略（主要用于自适应超时） */
    reset(): void;
}
/**
 * TimeoutResult —— 超时执行的结果。
 */
export type TimeoutResult<T> = {
    success: true;
    value: T;
    elapsedMs: number;
} | {
    success: false;
    error: Error;
    elapsedMs: number;
};
/**
 * CircuitBreakerOpenError —— 断路器熔断时抛出的错误。
 */
export declare class CircuitBreakerOpenError extends Error {
    readonly circuitName: string;
    readonly state: CircuitState;
    constructor(circuitName: string);
}
/**
 * TimeoutError —— 超时错误。
 */
export declare class TimeoutError extends Error {
    readonly timeoutMs: number;
    readonly elapsedMs: number;
    constructor(timeoutMs: number, elapsedMs: number);
}
/**
 * ResilienceContext —— 执行韧性策略时的共享上下文。
 *
 * 记录执行链路信息，供日志、监控、事件溯源使用。
 */
export interface ResilienceContext {
    /** 全局唯一执行 ID */
    readonly executionId: string;
    /** 策略名称 */
    readonly policyName: string;
    /** 策略名称链 */
    readonly policyChain: string[];
    /** 起始时间戳 */
    readonly startedAt: number;
    /** 重试计数器 */
    attempt: number;
    /** 自定义属性 */
    metadata: Map<string, unknown>;
}
/**
 * ResilienceContextManager —— 上下文管理器（基于 AsyncLocalStorage）。
 *
 * 确保同一链路共享同一上下文，无需显式传递。
 * 在 Node.js 环境中使用 AsyncLocalStorage 实现异步上下文传播。
 */
export declare class ResilienceContextManager {
    private static readonly _storage;
    /**
     * 在上下文中执行异步函数。
     * 自动生成 executionId 并注入上下文。
     */
    static run<T>(policyName: string, fn: (ctx: ResilienceContext) => Promise<T>): Promise<T>;
    /** 获取当前上下文 */
    static current(): ResilienceContext | undefined;
    /** 生成全局唯一执行 ID */
    private static _generateId;
}
/**
 * IResilienceRegistry —— 韧性策略注册中心接口。
 *
 * 职责：
 * 1. 注册/查询/卸载策略实例
 * 2. 组合执行（retry → circuitBreaker → timeout 嵌套）
 * 3. 状态快照与监控
 * 4. 全局事件通知
 */
export interface IResilienceRegistry {
    /**
     * 注册一组策略到指定名称。
     * 同名注册会覆盖已有条目（emit REGISTRY_OVERWRITE 事件）。
     *
     * @param name 策略组名称（如 'llm-api', 'search-backend'）
     * @param policies 策略集合
     */
    register(name: string, policies: {
        retry?: IRetryPolicy;
        circuitBreaker?: ICircuitBreaker;
        timeout?: ITimeoutPolicy;
    }): void;
    /** 卸载指定名称的所有策略 */
    unregister(name: string): void;
    /** 获取指定名称的重试策略 */
    getRetry(name: string): IRetryPolicy | undefined;
    /** 获取指定名称的断路器 */
    getCircuitBreaker(name: string): ICircuitBreaker | undefined;
    /** 获取指定名称的超时策略 */
    getTimeout(name: string): ITimeoutPolicy | undefined;
    /**
     * 在指定策略保护下执行函数。
     * 执行顺序：timeout → circuitBreaker → retry → fn
     *
     * @param name 注册的策略组名称
     * @param fn 要执行的函数
     * @param overrides 可选覆盖配置（临时替换已注册策略，不影响注册表）
     */
    execute<T>(name: string, fn: () => Promise<T>, overrides?: {
        retry?: IRetryPolicy;
        circuitBreaker?: ICircuitBreaker;
        timeout?: ITimeoutPolicy;
    }): Promise<T>;
    /**
     * 获取所有已注册策略的快照。
     * 用于监控面板/健康检查。
     */
    snapshot(): Array<{
        name: string;
        retry: string | null;
        circuitBreaker: {
            name: string;
            state: CircuitState;
        } | null;
        timeout: string | null;
    }>;
    /** 全局重置所有策略（测试/恢复用） */
    reset(): void;
    /** 注册全局状态变更监听器 */
    onEvent(handler: (event: ResilienceEvent) => void): void;
}
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
export declare class Registry implements IResilienceRegistry {
    /** 内部策略存储 */
    private readonly _store;
    /** 事件处理器列表 */
    private readonly _eventHandlers;
    private static readonly _defaultNoRetry;
    private static readonly _defaultNoBreaker;
    private static readonly _defaultNoTimeout;
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
    static create(defaults?: {
        retry?: IRetryPolicy;
        circuitBreaker?: ICircuitBreaker;
        timeout?: ITimeoutPolicy;
    }): Registry;
    register(name: string, policies: {
        retry?: IRetryPolicy;
        circuitBreaker?: ICircuitBreaker;
        timeout?: ITimeoutPolicy;
    }): void;
    unregister(name: string): void;
    getRetry(name: string): IRetryPolicy | undefined;
    getCircuitBreaker(name: string): ICircuitBreaker | undefined;
    getTimeout(name: string): ITimeoutPolicy | undefined;
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
    execute<T>(name: string, fn: () => Promise<T>, overrides?: {
        retry?: IRetryPolicy;
        circuitBreaker?: ICircuitBreaker;
        timeout?: ITimeoutPolicy;
    }): Promise<T>;
    /**
     * 带重试保护的执行。
     * 内部递归：每次失败后判断是否应重试，重试时等待 nextDelay。
     */
    private _executeWithRetry;
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
    snapshot(): Array<{
        name: string;
        retry: string | null;
        circuitBreaker: {
            name: string;
            state: CircuitState;
        } | null;
        timeout: string | null;
    }>;
    /**
     * 全局重置所有策略到初始状态。
     * 遍历所有已注册策略，依次调用其 reset() 方法。
     */
    reset(): void;
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
    onEvent(handler: (event: ResilienceEvent) => void): void;
    /**
     * 向所有注册的事件处理器发射事件。
     * 单个处理器的异常不会影响其他处理器（异常隔离）。
     */
    private _emit;
}
//# sourceMappingURL=Registry.d.ts.map