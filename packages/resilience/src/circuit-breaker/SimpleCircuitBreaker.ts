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

import {
  type ICircuitBreaker,
  type CircuitState,
  CircuitBreakerOpenError,
} from '../registry/Registry.js';

// ============================================================
// ── SimpleCircuitBreaker 选项 ──
// ============================================================

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
export class SimpleCircuitBreaker implements ICircuitBreaker {
  /** 断路器名称 */
  readonly name: string;

  /** 当前内部状态 */
  private _state: CircuitState = 'CLOSED';

  /** 连续失败计数器 */
  private _consecutiveFailures = 0;

  /** 进入 OPEN 状态的时间戳（毫秒） */
  private _openedAt = 0;

  /** 状态变更事件处理器列表 */
  private readonly _handlers: Array<(state: CircuitState, previous: CircuitState) => void> = [];

  /**
   * 原子试探门闩——HALF_OPEN 下仅首个请求执行 fn 并持有此门闩，
   * 其余并发请求快速失败（走 fallback 或抛 CircuitBreakerOpenError），
   * 防止同一 tick 内所有并发 call 全部穿透放行。
   */
  private _halfOpenProbe: Promise<unknown> | null = null;

  /** 连续失败阈值 */
  private readonly _threshold: number;

  /** 熔断后到半开的等待时间（毫秒） */
  private readonly _halfOpenAfterMs: number;

  /**
   * 创建一个 SimpleCircuitBreaker 实例。
   *
   * @param options 配置选项
   *
   * @throws {RangeError} 当 threshold < 1 或 halfOpenAfterMs < 0 时抛出
   */
  constructor(options: SimpleCircuitBreakerOptions) {
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
  get state(): CircuitState {
    return this._state;
  }

  /**
   * 当前连续失败次数（只读）。
   * 用于监控和调试。
   */
  get consecutiveFailures(): number {
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
  async call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    // ── 状态预检 ──
    if (this._state === 'OPEN') {
      // 检查是否应进入 HALF_OPEN
      if (Date.now() - this._openedAt >= this._halfOpenAfterMs) {
        this._transitionTo('HALF_OPEN');
      } else {
        // 熔断中：执行降级或快速失败
        if (fallback !== undefined) {
          return await fallback();
        }
        throw new CircuitBreakerOpenError(this.name);
      }
    }

    // HALF_OPEN：原子试探门闩——仅首个请求执行 fn，其余并发请求快速失败
    if (this._state === 'HALF_OPEN') {
      return await this._handleHalfOpenCall(fn, fallback);
    }

    // CLOSED：正常放行调用
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      // fallback 仅在 OPEN 状态下生效（阻止 fn 穿透）
      // CLOSED/HALF_OPEN 状态下，原始错误直接传播给 retry 循环
      if (fallback !== undefined && this._state === 'OPEN') {
        return await fallback();
      }
      throw err;
    }
  }

  /**
   * 处理 HALF_OPEN 状态下的调用——原子试探门闩。
   *
   * 并发穿透防护：同一时刻仅首个请求执行 fn 并持有门闩，
   * 其余并发请求快速失败（走 fallback 或抛 CircuitBreakerOpenError），
   * 防止 OPEN 超时后同一 tick 内所有并发 call 全部穿透。
   * 试探落定后统一裁决：
   *   - 成功 → recordSuccess → HALF_OPEN → CLOSED（闭合）
   *   - 失败 → recordFailure → HALF_OPEN → OPEN（重新熔断）
   *
   * @param fn 被保护的异步函数
   * @param fallback 可选降级函数
   * @returns 试探结果或降级结果
   * @throws {CircuitBreakerOpenError} 门闩被占用且无 fallback 时抛出
   */
  private async _handleHalfOpenCall<T>(
    fn: () => Promise<T>,
    fallback?: () => Promise<T>,
  ): Promise<T> {
    // 已有试探在途 → 非试探请求快速失败（不记录——避免污染成功/失败计数）
    if (this._halfOpenProbe !== null) {
      if (fallback !== undefined) {
        return await fallback();
      }
      throw new CircuitBreakerOpenError(this.name);
    }

    // 成为唯一试探：持有门闩，落定后统一裁决
    const probe: Promise<T> = Promise.resolve()
      .then(() => fn())
      .then(
        (result) => {
          this._halfOpenProbe = null;
          // 试探成功 → recordSuccess → HALF_OPEN → CLOSED
          this.recordSuccess();
          return result;
        },
        (err: unknown) => {
          this._halfOpenProbe = null;
          // 试探失败 → recordFailure → HALF_OPEN → OPEN
          this.recordFailure();
          throw err;
        },
      );
    this._halfOpenProbe = probe;

    try {
      return await probe;
    } catch (err) {
      // 试探失败已回到 OPEN——此时执行 fallback 或抛原始错误
      if (fallback !== undefined && this._state === 'OPEN') {
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
  recordSuccess(): void {
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
  recordFailure(): void {
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
  reset(): void {
    this._consecutiveFailures = 0;
    this._openedAt = 0;
    this._halfOpenProbe = null;
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
  forceState(state: CircuitState): void {
    if (state === 'CLOSED') {
      this._consecutiveFailures = 0;
      this._openedAt = 0;
    } else if (state === 'OPEN') {
      this._openedAt = Date.now();
    }
    // HALF_OPEN: 不需要特殊处理
    // 强制转换时释放试探门闩——在途 probe 的裁决回调仍执行但不会引用失效门闩
    this._halfOpenProbe = null;

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
  onStateChange(handler: (state: CircuitState, previous: CircuitState) => void): () => void {
    this._handlers.push(handler);
    return () => { const i = this._handlers.indexOf(handler); if (i >= 0) this._handlers.splice(i, 1); };
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
  private _transitionTo(newState: CircuitState): void {
    if (this._state === newState) {
      return;
    }

    const previous = this._state;
    this._state = newState;

    if (newState === 'OPEN') {
      this._openedAt = Date.now();
    } else {
      this._openedAt = 0;
    }

    // 通知所有状态变更处理器
    for (const handler of this._handlers) {
      try {
        handler(newState, previous);
      } catch {
        // 事件处理器异常隔离 —— 不中断其他处理器
      }
    }
  }
}
