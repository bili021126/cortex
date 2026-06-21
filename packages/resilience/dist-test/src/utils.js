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
export function getErrorName(err) {
    if (err === null || err === undefined)
        return undefined;
    if (typeof err !== 'object')
        return undefined;
    // 安全访问 name 属性——可能不存在或是非 string 类型
    const name = err.name;
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
export function getErrorMessage(err, fallback = 'Unknown error') {
    if (err === null || err === undefined)
        return fallback;
    if (typeof err === 'string')
        return err;
    if (err instanceof Error)
        return err.message;
    // 尝试安全访问 message 属性
    if (typeof err === 'object') {
        const msg = err.message;
        if (typeof msg === 'string')
            return msg;
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
export function toError(err) {
    if (err instanceof Error)
        return err;
    if (typeof err === 'string')
        return new Error(err);
    return new Error(String(err));
}
// ============================================================
// ── AbortSignal 合并 ──
// ============================================================
/**
 * 合并多个 AbortSignal 为一个组合信号。
 *
 * 当任意一个源信号 abort 时，组合信号也随之 abort。
 * 若任一源信号已 abort，返回该信号。
 *
 * 策略（按优先级）：
 * 1. AbortSignal.any() — Node.js 20+ / 现代浏览器
 * 2. 手动合并 — 通过监听所有信号的 abort 事件同步给新 controller
 *
 * @param signals 要合并的 AbortSignal 列表
 * @returns 合并后的 AbortSignal
 *
 * @example
 * ```typescript
 * const combined = combineSignals([externalSignal, timeoutSignal]);
 * // 当 externalSignal 或 timeoutSignal 任一 abort 时，combined 也 abort
 * ```
 */
export function combineSignals(signals) {
    if (signals.length === 0) {
        return new AbortController().signal;
    }
    if (signals.length === 1) {
        return signals[0];
    }
    // 检查是否有已中止的信号
    for (const signal of signals) {
        if (signal.aborted) {
            return signal;
        }
    }
    // 优先使用 AbortSignal.any()（Node.js 20+）
    if (typeof AbortSignal.any === 'function') {
        return AbortSignal.any(signals);
    }
    // 降级方案：手动合并
    const controller = new AbortController();
    const abortMerged = () => {
        controller.abort();
    };
    for (const signal of signals) {
        signal.addEventListener('abort', abortMerged, { once: true });
    }
    return controller.signal;
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
export function createTimeoutSignal(timeoutMs) {
    if (typeof AbortSignal.timeout === 'function') {
        const signal = AbortSignal.timeout(timeoutMs);
        // AbortSignal.timeout 创建的信号无需手动清理
        return [signal, () => { }];
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const cleanup = () => {
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
export function clamp(value, min, max) {
    if (value < min)
        return min;
    if (value > max)
        return max;
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
export function sleep(ms) {
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
export function hasAsyncLocalStorage() {
    if (typeof globalThis === 'undefined')
        return false;
    const als = globalThis.AsyncLocalStorage;
    return typeof als === 'function';
}
//# sourceMappingURL=utils.js.map