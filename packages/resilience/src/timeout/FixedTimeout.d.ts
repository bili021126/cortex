import { type ITimeoutPolicy, type TimeoutResult } from '../registry/Registry.js';
/**
 * FixedTimeoutOptions —— 固定超时策略的配置选项。
 */
export interface FixedTimeoutOptions {
    /** 超时阈值（毫秒），必须为正整数 */
    readonly durationMs: number;
    /**
     * 超时后是否取消 pending 操作。
     * - true（默认）：超时后通过 AbortSignal 通知 fn 取消
     * - false：超时后仅返回 TimeoutResult，不主动取消
     */
    readonly cancelOnTimeout?: boolean;
}
/**
 * FixedTimeout —— 固定超时策略。
 *
 * 使用 AbortSignal.timeout 实现超时控制，当环境不支持时
 * 自动降级为 AbortController + setTimeout 方案。
 * 同时使用 Promise.race 作为兜底，确保即使 fn 不响应
 * AbortSignal 也能在超时后返回结果。
 *
 * 适用场景：
 * - 常规 API 调用超时（如 HTTP 请求）
 * - 插件执行超时
 * - MCP 调用超时
 * - 任何需要固定时长超时的异步操作
 *
 * @example
 * ```typescript
 * // 基本用法
 * const timeout = new FixedTimeout({ durationMs: 5000 });
 *
 * const result = await timeout.execute(async (signal) => {
 *   const response = await fetch(url, { signal });
 *   return response.json();
 * });
 *
 * if (result.success) {
 *   console.log('完成耗时:', result.elapsedMs);
 * } else {
 *   console.error('失败:', result.error);
 * }
 *
 * // 配合 Registry 使用
 * const registry = Registry.create({
 *   timeout: new FixedTimeout({ durationMs: 15000 }),
 * });
 * ```
 */
export declare class FixedTimeout implements ITimeoutPolicy {
    /** 策略名称，用于日志和监控 */
    readonly name = "fixed-timeout";
    /** 固定超时值（毫秒） */
    readonly timeoutMs: number;
    /** 超时后是否取消 pending 操作 */
    private readonly _cancelOnTimeout;
    /**
     * @param options 配置选项
     * @throws {RangeError} 当 durationMs 不是正数时抛出
     *
     * @example
     * ```typescript
     * const timeout = new FixedTimeout({ durationMs: 30000 });
     * const timeoutNoCancel = new FixedTimeout({ durationMs: 10000, cancelOnTimeout: false });
     * ```
     */
    constructor(options: FixedTimeoutOptions);
    /**
     * 在超时保护下执行异步函数。
     *
     * 执行流程：
     * 1. 创建 AbortSignal （超时计时开始）
     * 2. 合并外部 signal（如有）
     * 3. 通过 Promise.race 同时执行 fn 和超时兜底
     * 4. fn 先完成 → 返回成功结果
     * 5. 超时先触发 → 返回 TimeoutError 结果
     * 6. fn 本身抛异常 → 返回失败结果
     *
     * @param fn 要执行的异步函数，接收 AbortSignal 作为可选参数
     *            当超时发生时，signal 被 abort，fn 可据此取消操作
     * @param signal 外部取消信号（可选），用于调用方主动取消
     * @returns TimeoutResult 包含执行结果或超时/错误信息
     *
     * @example
     * ```typescript
     * const result = await timeout.execute(async (signal) => {
     *   const resp = await fetch('https://api.example.com', { signal });
     *   return resp.json();
     * });
     *
     * if (result.success) {
     *   console.log('数据:', result.value, '耗时:', result.elapsedMs);
     * } else {
     *   console.error('超时或错误:', result.error);
     * }
     * ```
     */
    execute<T>(fn: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<TimeoutResult<T>>;
    /**
     * 重置策略状态。
     *
     * FixedTimeout 是无状态策略（超时值固定不变），
     * reset() 为空操作，仅用于满足接口约定。
     */
    reset(): void;
    /**
     * 合并两个 AbortSignal。
     *
     * 当任一信号 abort 时，合并后的信号也随之 abort。
     *
     * 策略：
     * 1. 优先使用 AbortSignal.any()（Node.js 20+）
     * 2. 降级：在两者上各自监听 abort 事件，同步给一个新 controller
     *
     * @param external 外部调用方传入的取消信号
     * @param timeout 超时信号
     * @returns 合并后的 AbortSignal
     */
    private _combineSignals;
    /**
     * 将捕获的异常分类转换为 TimeoutResult。
     *
     * 使用 getErrorName 安全提取错误名称，避免类型断言。
     *
     * 分类规则：
     * - TimeoutError / DOMException TimeoutError → 超时错误
     * - AbortError（且耗时 ≥ timeoutMs）→ 超时错误
     * - AbortError（耗时 < timeoutMs）→ 外部取消
     * - 其他异常 → 原样返回
     *
     * @param err 捕获的原始异常（unknown 类型，使用工具函数安全处理）
     * @param elapsedMs 已耗时
     * @returns 分类后的 TimeoutResult
     */
    private _classifyError;
}
//# sourceMappingURL=FixedTimeout.d.ts.map