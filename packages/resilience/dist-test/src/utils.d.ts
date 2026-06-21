/**
 * 可中止（abortable）资源的清理函数。
 * 调用后释放所有关联的计时器和事件监听器。
 */
export type CleanupFn = () => void;
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
export declare function getErrorName(err: unknown): string | undefined;
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
export declare function getErrorMessage(err: unknown, fallback?: string): string;
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
export declare function toError(err: unknown): Error;
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
export declare function combineSignals(signals: AbortSignal[]): AbortSignal;
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
export declare function createTimeoutSignal(timeoutMs: number): [AbortSignal, CleanupFn];
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
export declare function clamp(value: number, min: number, max: number): number;
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
export declare function sleep(ms: number): Promise<void>;
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
export declare function hasAsyncLocalStorage(): boolean;
//# sourceMappingURL=utils.d.ts.map