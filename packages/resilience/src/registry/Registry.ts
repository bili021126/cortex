import type { AsyncLocalStorage } from 'node:async_hooks';
import { hasAsyncLocalStorage, toError, sleep } from '../utils.js';

// ============================================================
// @cortex/resilience — Registry 韧性策略注册中心
//
// @file-overview
// Registry 是韧性策略的统一注册中心，管理重试（Retry）、
// 断路器（CircuitBreaker）、超时（Timeout）三类策略的
// 注册、查找与组合执行。
//
// 执行顺序（由外到内）：
//   timeout → circuitBreaker → retry → fn
//
// 此顺序确保：
//   - 超时在最外层切断总墙钟时间
//   - 断路器在中间层防止重试冲击下游
//   - 重试在最内层快速失败重试
//
// @design 详见 DESIGN.md §6「编排层：注册与组合」
// ============================================================

// ============================================================
// ── 类型定义 ──
// ============================================================

/** 断路器三态 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/** 韧性事件 —— 用于全局事件监听与监控 */
export type ResilienceEvent =
  | { type: 'RETRY_ATTEMPT'; name: string; attempt: number; delayMs: number }
  | { type: 'RETRY_EXHAUSTED'; name: string; attempt: number }
  | { type: 'CIRCUIT_STATE_CHANGE'; name: string; from: CircuitState; to: CircuitState }
  | { type: 'CIRCUIT_OPEN'; name: string }
  | { type: 'CIRCUIT_HALF_OPEN'; name: string }
  | { type: 'CIRCUIT_CLOSED'; name: string }
  | { type: 'TIMEOUT_OCCURRED'; name: string; timeoutMs: number; elapsedMs: number }
  | { type: 'ADAPTIVE_TIMEOUT_UPDATE'; name: string; newTimeoutMs: number }
  | { type: 'REGISTRY_OVERWRITE'; name: string }
  | { type: 'EXECUTION_ERROR'; name: string; error: Error };

// ============================================================
// ── 策略接口契约 ──
// ============================================================

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

  /** 订阅状态变更事件。返回取消订阅的函数 */
  onStateChange(handler: (state: CircuitState, previous: CircuitState) => void): () => void;
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
export type TimeoutResult<T> =
  | { success: true; value: T; elapsedMs: number }
  | { success: false; error: Error; elapsedMs: number };

// ============================================================
// ── 错误类型 ──
// ============================================================

/**
 * CircuitBreakerOpenError —— 断路器熔断时抛出的错误。
 */
export class CircuitBreakerOpenError extends Error {
  readonly circuitName: string;
  readonly state: CircuitState;

  constructor(circuitName: string) {
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
  readonly timeoutMs: number;
  readonly elapsedMs: number;

  constructor(timeoutMs: number, elapsedMs: number) {
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
class NoRetry implements IRetryPolicy {
  readonly name = 'no-retry';
  readonly maxAttempts = 1;

  nextDelay(_attempt: number, _error?: unknown): number {
    return 0;
  }

  shouldRetry(_attempt: number, _error?: unknown): boolean {
    return false;
  }

  reset(): void {
    // 无状态，无需重置
  }
}

/** 不熔断策略 —— 用于显式关闭断路器保护 */
class NoBreaker implements ICircuitBreaker {
  readonly name = 'no-breaker';
  readonly state: CircuitState = 'CLOSED';

  async call<T>(fn: () => Promise<T>, _fallback?: () => Promise<T>): Promise<T> {
    return await fn();
  }

  recordSuccess(): void {
    // 无操作
  }

  recordFailure(): void {
    // 无操作
  }

  reset(): void {
    // 无操作
  }

  forceState(_state: CircuitState): void {
    // 无操作
  }

  onStateChange(_handler: (state: CircuitState, previous: CircuitState) => void): () => void {
    return () => {};
  }
}

/** 不超时策略 —— 用于显式关闭超时保护 */
class NoTimeout implements ITimeoutPolicy {
  readonly name = 'no-timeout';
  readonly timeoutMs = Infinity;

  async execute<T>(fn: (signal?: AbortSignal) => Promise<T>, _signal?: AbortSignal): Promise<TimeoutResult<T>> {
    const startedAt = Date.now();
    try {
      const value = await fn();
      return { success: true, value, elapsedMs: Date.now() - startedAt };
    } catch (err) {
      return { success: false, error: toError(err), elapsedMs: Date.now() - startedAt };
    }
  }

  reset(): void {
    // 无状态，无需重置
  }
}

// ============================================================
// ── 执行上下文 ──
// ============================================================

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
export class ResilienceContextManager {
  private static readonly _storage: AsyncLocalStorage<ResilienceContext> | null = (() => {
    if (!hasAsyncLocalStorage()) return null;
    const ALS = (globalThis as Record<string, unknown>).AsyncLocalStorage as new () => AsyncLocalStorage<ResilienceContext>;
    return typeof ALS === 'function' ? new ALS() : null;
  })();

  /**
   * 在上下文中执行异步函数。
   * 自动生成 executionId 并注入上下文。
   */
  static async run<T>(policyName: string, fn: (ctx: ResilienceContext) => Promise<T>): Promise<T> {
    const context: ResilienceContext = {
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
  static current(): ResilienceContext | undefined {
    return this._storage?.getStore();
  }

  /** 生成全局唯一执行 ID */
  private static _generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `${timestamp}-${random}`;
  }
}

// ============================================================
// ── IResilienceRegistry 接口 —— 注册中心契约 ──
// ============================================================

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
    circuitBreaker: { name: string; state: CircuitState } | null;
    timeout: string | null;
  }>;

  /** 全局重置所有策略（测试/恢复用） */
  reset(): void;

  /** 注册全局状态变更监听器 */
  onEvent(handler: (event: ResilienceEvent) => void): void;
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
export class Registry implements IResilienceRegistry {
  /** 内部策略存储 */
  private readonly _store = new Map<string, {
    retry: IRetryPolicy;
    circuitBreaker: ICircuitBreaker;
    timeout: ITimeoutPolicy;
  }>();

  /** 事件处理器列表 */
  private readonly _eventHandlers: Array<(event: ResilienceEvent) => void> = [];

  // ── 默认策略实例（复用，避免重复分配） ──
  private static readonly _defaultNoRetry = new NoRetry();
  private static readonly _defaultNoBreaker = new NoBreaker();
  private static readonly _defaultNoTimeout = new NoTimeout();

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
  }): Registry {
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

  register(
    name: string,
    policies: {
      retry?: IRetryPolicy;
      circuitBreaker?: ICircuitBreaker;
      timeout?: ITimeoutPolicy;
    },
  ): void {
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

  unregister(name: string): void {
    this._store.delete(name);
  }

  getRetry(name: string): IRetryPolicy | undefined {
    return this._store.get(name)?.retry;
  }

  getCircuitBreaker(name: string): ICircuitBreaker | undefined {
    return this._store.get(name)?.circuitBreaker;
  }

  getTimeout(name: string): ITimeoutPolicy | undefined {
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
  async execute<T>(
    name: string,
    fn: () => Promise<T>,
    overrides?: {
      retry?: IRetryPolicy;
      circuitBreaker?: ICircuitBreaker;
      timeout?: ITimeoutPolicy;
    },
  ): Promise<T> {
    const policies = this._store.get(name);
    if (!policies) {
      throw new Error(`No resilience policies registered for "${name}". ` +
        `Call registry.register('${name}', ...) first.`);
    }

    const retry = overrides?.retry ?? policies.retry;
    const cb = overrides?.circuitBreaker ?? policies.circuitBreaker;
    const timeout = overrides?.timeout ?? policies.timeout;

    return await ResilienceContextManager.run(name, async (ctx) => {
      const wrapped = async (): Promise<T> => {
        return await this._executeWithRetry(name, retry, cb, timeout, fn, ctx);
      };

      try {
        return await wrapped();
      } catch (err) {
        this._emit({ type: 'EXECUTION_ERROR', name, error: err instanceof Error ? err : new Error(String(err)) });
        throw err;
      }
    });
  }

  /**
   * 带重试保护的执行。
   * 内部递归：每次失败后判断是否应重试，重试时等待 nextDelay。
   */
  private async _executeWithRetry<T>(
    name: string,
    retry: IRetryPolicy,
    cb: ICircuitBreaker,
    timeout: ITimeoutPolicy,
    fn: () => Promise<T>,
    ctx: ResilienceContext,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      ctx.attempt = attempt;

      try {
        // 嵌套：断路器 -> 超时 -> fn
        return await cb.call(
          async () => {
            const timeoutResult = await timeout.execute(
              async (_signal?: AbortSignal) => await fn(),
            );

            if (!timeoutResult.success) {
              throw timeoutResult.error;
            }
            return timeoutResult.value;
          },
          // 熔断降级：断路器已 OPEN → 不调 fn()，阻止穿透
          async () => {
            throw new CircuitBreakerOpenError(cb.name);
          },
        );
      } catch (err) {
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
  snapshot(): Array<{
    name: string;
    retry: string | null;
    circuitBreaker: { name: string; state: CircuitState } | null;
    timeout: string | null;
  }> {
    const result: Array<{
      name: string;
      retry: string | null;
      circuitBreaker: { name: string; state: CircuitState } | null;
      timeout: string | null;
    }> = [];

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
  reset(): void {
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
  onEvent(handler: (event: ResilienceEvent) => void): () => void {
    this._eventHandlers.push(handler);
    // 与 onStateChange 契约对齐：返回取消函数，调用方可显式退订防泄漏
    return () => {
      const i = this._eventHandlers.indexOf(handler);
      if (i >= 0) this._eventHandlers.splice(i, 1);
    };
  }

  // ────────────────────────────────────────
  // 内部工具方法
  // ────────────────────────────────────────

  /**
   * 向所有注册的事件处理器发射事件。
   * 单个处理器的异常不会影响其他处理器（异常隔离）。
   */
  private _emit(event: ResilienceEvent): void {
    for (const handler of this._eventHandlers) {
      try {
        handler(event);
      } catch {
        // 事件处理器异常隔离 —— 不中断其他处理器
      }
    }
  }

}
