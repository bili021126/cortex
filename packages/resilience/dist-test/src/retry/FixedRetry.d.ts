import type { IRetryPolicy } from "../registry/Registry.js";
/**
 * FixedRetryOptions —— FixedRetry 策略的配置选项。
 *
 * 控制最大尝试次数、固定间隔、错误类型过滤等行为。
 *
 * @example
 * ```typescript
 * const options: FixedRetryOptions = {
 *   maxAttempts: 3,
 *   delayMs: 2000,
 *   retryableErrors: [NetworkError, TimeoutError],
 * };
 * ```
 */
export interface FixedRetryOptions {
    /**
     * 最大尝试次数（含首次调用）。
     * maxAttempts=3 表示首次 + 2 次重试。
     * 必须 ≥ 1。
     * @default 3
     */
    maxAttempts?: number;
    /**
     * 每次重试前的固定等待时间（毫秒）。
     * 必须 ≥ 0。为 0 时表示立即重试（无等待）。
     * @default 1000
     */
    delayMs?: number;
    /**
     * 最大延迟上限（毫秒）。
     * 当 delayMs 超过此值时，实际等待时间被截断到此值。
     * 不设置则表示无上限。
     */
    maxDelayMs?: number;
    /**
     * 可重试的异常类白名单。
     * 只有当抛出的异常是列表中某个类的实例时，才触发重试。
     * 空数组或 undefined 表示所有异常均可重试。
     *
     * @example
     * ```typescript
     * retryableErrors: [RateLimitError, ServiceUnavailableError]
     * ```
     */
    retryableErrors?: Array<{
        new (...args: unknown[]): Error;
    }>;
    /**
     * 自定义 shouldRetry 钩子。
     * 在默认判断逻辑之后执行，可覆盖默认的重试决定。
     * 返回 true 强制重试，返回 false 强制停止重试。
     * 返回 undefined 则使用默认判断。
     *
     * @param attempt 当前尝试次数（1-based）
     * @param error 最近一次异常
     */
    shouldRetry?: (attempt: number, error: unknown) => boolean | undefined;
}
/**
 * FixedRetry —— 固定重试次数与固定等待间隔的重试策略。
 *
 * 退避公式：
 *   delay = min(delayMs, maxDelayMs ?? delayMs)
 *   即每次重试等待时间相同，可被 maxDelayMs 截断。
 *
 * 行为特性：
 *   - 每次重试前等待固定时长（不随尝试次数增加而变化）
 *   - 支持按异常类型过滤（仅白名单内的异常触发重试）
 *   - 支持自定义 shouldRetry 钩子
 *   - 无内部状态 —— 可安全复用
 *
 * @example
 * ```typescript
 * // 基础用法：最多重试 2 次，每次等待 1.5 秒
 * const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1500 });
 *
 * // 带错误过滤：仅对 RateLimitError 重试
 * const retry = new FixedRetry({
 *   maxAttempts: 5,
 *   delayMs: 2000,
 *   retryableErrors: [RateLimitError],
 * });
 *
 * // 与 Registry 组合使用
 * registry.register('my-service', {
 *   retry: new FixedRetry({ maxAttempts: 3, delayMs: 1000 }),
 * });
 * ```
 */
export declare class FixedRetry implements IRetryPolicy {
    /** 策略名称，用于日志和监控 */
    readonly name = "fixed-retry";
    /** 最大尝试次数（含首次） */
    readonly maxAttempts: number;
    /** 每次重试前的固定等待时间（毫秒） */
    readonly delayMs: number;
    /** 最大延迟上限（毫秒），undefined 表示无上限 */
    readonly maxDelayMs?: number;
    /** 可重试的异常类白名单 */
    private readonly _retryableErrors;
    /** 自定义 shouldRetry 钩子 */
    private readonly _shouldRetryHook?;
    /**
     * 创建 FixedRetry 实例。
     *
     * @param options 配置选项
     *
     * @example
     * ```typescript
     * // 默认参数：3 次尝试，1 秒间隔
     * const retry = new FixedRetry();
     *
     * // 自定义参数
     * const retry = new FixedRetry({
     *   maxAttempts: 5,
     *   delayMs: 2000,
     *   maxDelayMs: 10000,
     *   retryableErrors: [RateLimitError],
     * });
     * ```
     */
    constructor(options?: FixedRetryOptions);
    /**
     * 获取下一次重试前的等待时间。
     *
     * 对于 FixedRetry，每次重试的等待时间恒定不变，
     * 即配置的 delayMs（受 maxDelayMs 截断）。
     *
     * @param attempt 当前重试次数（1-based，第 1 次表示首次失败后的重试）
     * @param _error 触发重试的异常（FixedRetry 不依赖异常决定等待时间）
     * @returns 等待毫秒数，始终为固定的 delayMs（受 maxDelayMs 截断）
     */
    nextDelay(_attempt: number, _error?: unknown): number;
    /**
     * 判断是否应继续重试。
     *
     * 判断逻辑（按优先级）：
     * 1. 如果自定义 shouldRetry 钩子存在：
     *    a. 钩子返回 true → true（强制重试，可覆盖 maxAttempts）
     *    b. 钩子返回 false → false（强制停止）
     *    c. 钩子返回 undefined → 继续默认判断
     * 2. 如果 attempt >= maxAttempts → false（已达到最大尝试次数）
     * 3. 如果 retryableErrors 白名单非空：
     *    a. error 是白名单中某个类的实例 → true
     *    b. 否则 → false
     * 4. 如果 retryableErrors 为空（不限制）→ true
     *
     * @param attempt 已执行的尝试次数（1-based）
     * @param error 最近一次异常
     * @returns true 表示应继续重试
     */
    shouldRetry(attempt: number, error?: unknown): boolean;
    /**
     * 重置策略状态。
     *
     * FixedRetry 是无状态策略 —— 所有决策基于配置参数和入参，
     * 不记录历史调用信息。因此 reset() 为空操作，
     * 仅用于满足 IRetryPolicy 接口契约。
     */
    reset(): void;
    /**
     * 获取当前配置的描述字符串。
     * 用于日志和监控标识。
     *
     * @example
     * ```typescript
     * retry.toString();
     * // => 'FixedRetry(maxAttempts=3, delayMs=1000)'
     * ```
     */
    toString(): string;
    /**
     * 创建当前策略的一个独立副本。
     *
     * 由于 FixedRetry 是无状态的，副本与原始实例行为完全一致。
     * 此方法主要用于需要独立策略实例的场景（如测试隔离）。
     *
     * @returns 新的 FixedRetry 实例，参数与当前实例相同
     */
    clone(): FixedRetry;
}
//# sourceMappingURL=FixedRetry.d.ts.map