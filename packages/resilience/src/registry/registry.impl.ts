/**
 * registry.impl —— 由 Registry.ts 拆分（2026-06-20 RES-1）。
 */

import type { CircuitState, ResilienceEvent, IRetryPolicy, ICircuitBreaker, ITimeoutPolicy } from "./registry.types.js";
import { CircuitBreakerOpenError, TimeoutError } from "./registry.types.js";
import type { ResilienceContext } from "./registry.context.js";
import { ResilienceContextManager } from "./registry.context.js";
import { sleep } from "../utils.js";
import { NoRetry, NoBreaker, NoTimeout } from "./registry.noop.js";

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

