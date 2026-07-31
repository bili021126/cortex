// ============================================================
// @cortex/resilience — 共享工具函数
//
// @file-overview
// 提供跨韧性策略包的内部共享工具函数。
// 所有函数均为纯函数或自包含工具，无外部依赖。
//
// 包含：
// - 错误类型安全处理（替代 err as Error / as any 断言）
// - AbortSignal 合并（替代 FixedTimeout / AdaptiveTimeout 中的重复实现）
// - 数值工具（clamp、sleep）
// - 特性检测（AsyncLocalStorage）
//
// 使用约定：
// - 仅在 @cortex/resilience 包内部使用
// - 不通过 barrel (index.ts) 导出——这些是内部实现细节
// - 保持纯函数无副作用
//
// @design 详见 review-report.md §2.1（类型安全）和 §2.2（重复代码消除）
// ============================================================

// ============================================================
// ── 工具类型 ──
// ============================================================

/**
 * 可中止（abortable）资源的清理函数。
 * 调用后释放所有关联的计时器和事件监听器。
 */
export type CleanupFn = () => void;

// ============================================================
// ── 错误类型安全处理 ──
// ============================================================

/**
 * 安全获取错误对象的 name 属性。
 *
 * 比 `(err as { name?: string }).name` 更安全，
 * 避免类型断言可能隐藏的运行时类型不匹配问题。
 *
 * @param err 任意未知类型的错误值
 * @returns 错误名称（若存在），否则返回 undefined
 *
 * @example
 * ```typescript
 * const name = getErrorName(new TypeError('bad')); // 'TypeError'
 * const name2 = getErrorName('string error');       // undefined
 * const name3 = getErrorName(null);                 // undefined
 * ```
 */
export function getErrorName(err: unknown): string | undefined {
  if (err === null || err === undefined) return undefined;
  if (typeof err !== 'object') return undefined;
  // 安全访问 name 属性——可能不存在或是非 string 类型
  const name = (err as Record<string, unknown>).name;
  return typeof name === 'string' ? name : undefined;
}

/**
 * 安全获取错误对象的 message 属性。
 *
 * @param err 任意未知类型的错误值
 * @param fallback 当无法获取消息时的默认值（默认 'Unknown error'）
 * @returns 错误消息字符串
 *
 * @example
 * ```typescript
 * const msg = getErrorMessage(new Error('boom')); // 'boom'
 * const msg2 = getErrorMessage('oops');           // 'Unknown error'
 * ```
 */
export function getErrorMessage(err: unknown, fallback = 'Unknown error'): string {
  if (err === null || err === undefined) return fallback;
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  // 尝试安全访问 message 属性
  if (typeof err === 'object') {
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === 'string') return msg;
  }
  return fallback;
}

/**
 * 将未知类型的错误值安全转换为 Error 实例。
 *
 * 转换规则：
 * - Error 实例 → 直接返回
 * - string → new Error(string)
 * - 其他 → new Error(String(value))
 *
 * @param err 任意未知类型的错误值
 * @returns Error 实例
 *
 * @example
 * ```typescript
 * const e1 = toError(new Error('boom')); // Error: boom
 * const e2 = toError('string error');     // Error: string error
 * const e3 = toError(42);                // Error: 42
 * ```
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  return new Error(String(err));
}

// ============================================================
// ── AbortSignal 合并 ──
// ============================================================

/**
 * 合并多个 AbortSignal 为一个组合信号。
 *
 * 内部委托给 combineSignalsWithCleanup——组合信号的监听器由源信号持有，
 * 若组合后从不 abort 且无清理，监听器会泄漏。本函数不返回清理函数（兼容旧签名），
 * 长生命周期场景请使用 combineSignalsWithCleanup 并在 finally 中调用 cleanup。
 *
 * @param signals 要合并的 AbortSignal 列表
 * @returns 合并后的 AbortSignal
 */
export function combineSignals(signals: AbortSignal[]): AbortSignal {
  return combineSignalsWithCleanup(signals).signal;
}

/**
 * 合并多个 AbortSignal 并返回清理函数。
 *
 * 当任意一个源信号 abort 时，组合信号也随之 abort。
 * 若任一源信号已 abort，返回该信号。
 *
 * 手动合并降级分支（无 AbortSignal.any）会在源信号上注册监听器——
 * 若组合信号从不 abort，监听器会永久残留。调用方必须在 finally 中调用 cleanup 移除。
 *
 * @param signals 要合并的 AbortSignal 列表
 * @returns { signal, cleanup }：signal 为合并信号，cleanup 移除手动合并分支的监听器
 *
 * @example
 * ```typescript
 * const { signal, cleanup } = combineSignalsWithCleanup([externalSignal, timeoutSignal]);
 * try {
 *   await fetch(url, { signal });
 * } finally {
 *   cleanup();
 * }
 * ```
 */
export function combineSignalsWithCleanup(signals: AbortSignal[]): { signal: AbortSignal; cleanup: CleanupFn } {
  if (signals.length === 0) {
    return { signal: new AbortController().signal, cleanup: () => { /* 无监听器 */ } };
  }

  if (signals.length === 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return { signal: signals[0]!, cleanup: () => { /* 无监听器 */ } };
  }

  // 检查是否有已中止的信号
  for (const signal of signals) {
    if (signal.aborted) {
      return { signal, cleanup: () => { /* 无监听器 */ } };
    }
  }

  // 优先使用 AbortSignal.any()（Node.js 20+，无监听器泄漏问题）
  if (typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any(signals), cleanup: () => { /* 无监听器 */ } };
  }

  // 降级方案：手动合并
  const controller = new AbortController();
  const abortMerged = (): void => {
    controller.abort();
  };

  const listeners: Array<[AbortSignal, () => void]> = [];
  for (const signal of signals) {
    signal.addEventListener('abort', abortMerged, { once: true });
    listeners.push([signal, abortMerged]);
  }

  return {
    signal: controller.signal,
    // P2 fix: 显式移除监听器——组合信号从不 abort 时防泄漏
    cleanup: () => {
      for (const [signal, listener] of listeners) {
        signal.removeEventListener('abort', listener);
      }
    },
  };
}

// ============================================================
// ── 超时清理工具 ──
// ============================================================

/**
 * 创建超时机制，返回超时信号和清理函数。
 *
 * 优先使用 AbortSignal.timeout()（Node.js 18+），
 * 降级使用 AbortController + setTimeout。
 *
 * @param timeoutMs 超时毫秒数
 * @returns [timeoutSignal, cleanup] 元组：
 *   - timeoutSignal: 超时时自动 abort 的信号
 *   - cleanup: 清理函数（清除计时器和监听器）
 *
 * @example
 * ```typescript
 * const [signal, cleanup] = createTimeoutSignal(5000);
 * try {
 *   await fetch(url, { signal });
 * } finally {
 *   cleanup();
 * }
 * ```
 */
export function createTimeoutSignal(timeoutMs: number): [AbortSignal, CleanupFn] {
  if (typeof AbortSignal.timeout === 'function') {
    const signal = AbortSignal.timeout(timeoutMs);
    // AbortSignal.timeout 创建的信号无需手动清理
    return [signal, () => { /* 无需操作 */ }];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const cleanup = (): void => {
    clearTimeout(timeoutId);
  };
  return [controller.signal, cleanup];
}

// ============================================================
// ── 数值工具 ──
// ============================================================

/**
 * 将数值限制在指定范围内。
 *
 * @param value 待限制的值
 * @param min 最小值（含）
 * @param max 最大值（含）
 * @returns 限制后的值
 *
 * @example
 * ```typescript
 * clamp(5, 0, 10);   // 5
 * clamp(-1, 0, 10);  // 0
 * clamp(15, 0, 10);  // 10
 * ```
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// ============================================================
// ── Promise 工具 ──
// ============================================================

/**
 * Promise 化的 setTimeout。
 *
 * @param ms 等待毫秒数
 * @returns 在指定时间后 resolve 的 Promise
 *
 * @example
 * ```typescript
 * await sleep(1000); // 等待 1 秒
 * ```
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// ── 特性检测 ──
// ============================================================

/**
 * 检测当前运行时是否支持 AsyncLocalStorage。
 *
 * 用于 ResilienceContextManager 的特性降级。
 * 在 Node.js 13.10+ 中支持，浏览器中不可用。
 *
 * @returns true 如果 AsyncLocalStorage 可用
 *
 * @example
 * ```typescript
 * if (hasAsyncLocalStorage()) {
 *   // 使用 ALS 实现上下文传播
 * } else {
 *   // 降级方案
 * }
 * ```
 */
export function hasAsyncLocalStorage(): boolean {
  if (typeof globalThis === 'undefined') return false;
  const als = (globalThis as Record<string, unknown>).AsyncLocalStorage;
  return typeof als === 'function';
}
