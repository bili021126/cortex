/**
 * registry.noop —— 由 Registry.ts 拆分（2026-06-20 RES-1）。
 */

import { toError } from "../utils.js";
import type { IRetryPolicy, ICircuitBreaker, ITimeoutPolicy, CircuitState, TimeoutResult } from "./registry.types.js";

export class NoRetry implements IRetryPolicy {
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
export class NoBreaker implements ICircuitBreaker {
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
export class NoTimeout implements ITimeoutPolicy {
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
