// ============================================================
// @cortex/resilience — ExponentialBackoff 指数退避重试策略
//
// 退避公式：delay = baseDelayMs * (2 ^ (attempt - 1)) + jitter
// 最大延迟受 maxDelayMs 限制。
//
// 适用场景：网络请求 / LLM API 调用 / 临时性服务不可用
//
// @design 详见 DESIGN.md §5.1.1「ExponentialBackoffRetry」
// ============================================================

import type { IRetryPolicy } from "../registry/Registry.js";

// ============================================================
// ── 类型定义 ──
// ============================================================

/**
 * RetryOptions —— 重试策略的通用配置。
 */
export interface RetryOptions {
  /** 最大尝试次数（含首次）。maxAttempts=3 表示首次 + 2 次重试 */
  maxAttempts: number;

  /** 基础延迟（毫秒） */
  baseDelayMs: number;

  /** 最大延迟上限（毫秒），默认 30000 */
  maxDelayMs?: number;

  /**
   * 可重试的异常类/类型列表。
   * 空数组 = 所有异常均可重试（默认）。
   */
  retryableErrors?: Array<{ new (...args: unknown[]): Error }>;

  /**
   * 自定义 shouldRetry 钩子。
   * 若提供，将优先于 retryableErrors 判断。
   */
  shouldRetry?: (attempt: number, error: unknown) => boolean;
}

// ============================================================
// ── ExponentialBackoff 类 ──
// ============================================================

/**
 * ExponentialBackoff —— 指数退避重试策略。
 *
 * 退避算法：
 *   delay = clamp(baseDelayMs × 2^(attempt-1), 0, maxDelayMs)
 *   delay += jitterFactor × clamped × random(-1, 1)  ← 抖动
 *
 * 特点：
 * - 指数增长避免频繁重试冲击下游
 * - 可配置抖动因子避免惊群效应
 * - 支持按异常类型过滤可重试错误
 * - 支持自定义 shouldRetry 钩子
 *
 * 默认退避序列（baseDelayMs=1000, jitterFactor=0）：
 *   attempt 1: 1000ms
 *   attempt 2: 2000ms
 *   attempt 3: 4000ms
 *   attempt 4: 8000ms
 *   attempt 5: 16000ms
 *   attempt 6+: 30000ms (受 maxDelayMs 限制)
 *
 * @example
 * ```typescript
 * // 基本用法
 * const retry = new ExponentialBackoff({
 *   maxAttempts: 3,
 *   baseDelayMs: 1000,
 * });
 *
 * // 在重试循环中使用
 * for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
 *   try {
 *     return await doRequest();
 *   } catch (err) {
 *     if (!retry.shouldRetry(attempt, err)) throw err;
 *     await sleep(retry.nextDelay(attempt, err));
 *   }
 * }
 * ```
 */
export class ExponentialBackoff implements IRetryPolicy {
  /** 策略名称，用于日志和监控 */
  readonly name = 'exponential-backoff';

  /** 最大尝试次数（含首次） */
  readonly maxAttempts: number;

  /** 基础延迟（毫秒） */
  private readonly _baseDelayMs: number;

  /** 最大延迟上限（毫秒） */
  private readonly _maxDelayMs: number;

  /**
   * 抖动因子，取值范围 [0, 0.5]。
   * - 0：无抖动，固定指数退避
   * - 0.1：±10% 抖动（默认）
   * - 0.5：±50% 抖动，分布更分散
   */
  private readonly _jitterFactor: number;

  /** 可重试的异常类列表（使用 unknown[] 替代 any[]，与 FixedRetry 保持一致） */
  private readonly _retryableErrors: Array<{ new (...args: unknown[]): Error }>;

  /** 自定义 shouldRetry 钩子 */
  private readonly _shouldRetryHook?: (attempt: number, error: unknown) => boolean;

  /**
   * 创建 ExponentialBackoff 实例。
   *
   * @param options 配置选项
   * @param options.maxAttempts - 最大尝试次数（含首次），默认 3
   * @param options.baseDelayMs - 基础延迟（毫秒），默认 1000
   * @param options.maxDelayMs - 最大延迟上限（毫秒），默认 30000
   * @param options.jitterFactor - 抖动因子 [0, 0.5]，默认 0.1
   * @param options.retryableErrors - 可重试的异常类列表，默认 []（全部可重试）
   * @param options.shouldRetry - 自定义重试判断钩子
   *
   * @throws {RangeError} 当 maxAttempts < 1 时
   * @throws {RangeError} 当 baseDelayMs < 0 时
   * @throws {RangeError} 当 jitterFactor 不在 [0, 0.5] 范围内时
   */
  constructor(options: RetryOptions & {
    /** 抖动因子 [0, 0.5]，默认 0.1（±10% 抖动） */
    jitterFactor?: number;
  }) {
    // ── 参数验证 ──
    if (options.maxAttempts < 1) {
      throw new RangeError(`ExponentialBackoff: maxAttempts must be >= 1, got ${options.maxAttempts}`);
    }
    if (options.baseDelayMs < 0) {
      throw new RangeError(`ExponentialBackoff: baseDelayMs must be >= 0, got ${options.baseDelayMs}`);
    }

    const jitter = options.jitterFactor ?? 0.1;
    if (jitter < 0 || jitter > 0.5) {
      throw new RangeError(
        `ExponentialBackoff: jitterFactor must be in [0, 0.5], got ${jitter}`,
      );
    }

    // ── 参数初始化 ──
    this.maxAttempts = options.maxAttempts;
    this._baseDelayMs = options.baseDelayMs;
    this._maxDelayMs = options.maxDelayMs ?? 30_000;
    this._jitterFactor = jitter;
    this._retryableErrors = options.retryableErrors ?? [];
    this._shouldRetryHook = options.shouldRetry;
  }

  /**
   * 获取下一次重试前的等待时间。
   *
   * 退避公式：
   *   delay = baseDelayMs × 2^(attempt - 1)
   *   delay = clamp(delay, 0, maxDelayMs)
   *   delay += delay × jitterFactor × uniform(-1, 1)  ← 抖动
   *
   * @param attempt - 当前重试次数（1-based）。attempt=1 表示首次失败后的第一次重试
   * @param _error - 触发重试的异常（当前实现中不参与延迟计算）
   * @returns 等待毫秒数，始终 ≥ 0
   */
  nextDelay(attempt: number, _error?: unknown): number {
    // 指数退避：baseDelayMs × 2^(attempt - 1)
    const exponential = this._baseDelayMs * Math.pow(2, attempt - 1);

    // 受最大延迟限制
    const clamped = Math.min(exponential, this._maxDelayMs);

    // 抖动：clamped × jitterFactor × uniform(-1, 1)
    const jitter = clamped * this._jitterFactor * (Math.random() * 2 - 1);

    // 确保返回非负整数
    return Math.max(0, Math.round(clamped + jitter));
  }

  /**
   * 判断是否应继续重试。
   *
   * 判断优先级：
   * 1. 存在 shouldRetry 钩子 → 委托给钩子（可覆盖 maxAttempts 硬限制）
   * 2. 超过 maxAttempts → 不重试
   * 3. retryableErrors 为空 → 全部可重试
   * 4. retryableErrors 非空 → 仅匹配的异常可重试
   *
   * @param attempt - 已执行的尝试次数
   * @param error - 最近一次异常
   * @returns true 表示应继续重试
   */
  shouldRetry(attempt: number, error?: unknown): boolean {
    // 自定义钩子优先 —— 钩子可覆盖 maxAttempts 硬限制
    if (this._shouldRetryHook) {
      return this._shouldRetryHook(attempt, error);
    }

    // 超过最大尝试次数 → 不重试
    if (attempt >= this.maxAttempts) {
      return false;
    }

    // 无可重试异常列表 → 全部可重试
    if (this._retryableErrors.length === 0) {
      return true;
    }

    // 检查异常是否匹配可重试类型
    if (error === undefined || error === null) {
      return false;
    }

    return this._retryableErrors.some(Err => error instanceof Err);
  }

  /**
   * 重置策略状态。
   *
   * ExponentialBackoff 本身是无状态的纯函数策略，
   * reset() 方法保留以符合 IRetryPolicy 接口契约。
   */
  reset(): void {
    // 无状态策略，无需重置
  }
}
