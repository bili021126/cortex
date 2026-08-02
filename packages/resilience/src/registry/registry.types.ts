/**
 * registry.types —— 由 Registry.ts 拆分（2026-06-20 RES-1）。
 */



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

