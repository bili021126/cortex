// ============================================================
// @cortex/resilience — FixedTimeout 固定超时策略
//
// @file-overview
// FixedTimeout 是固定超时策略实现，为异步操作提供统一的
// 超时控制。使用 AbortSignal 机制 + Promise.race 兜底，
// 确保超时后操作被安全终止。
//
// 特性：
// - 基于 AbortSignal.timeout()（Node.js 18+）
// - 降级方案：setTimeout + AbortController
// - Promise.race 兜底：即使 fn 不响应 AbortSignal 也能超时
// - 外部信号合并：支持调用方传入的外部取消信号
//
// @design 详见 DESIGN.md §5.3.1「FixedTimeoutPolicy」
// ============================================================
import { TimeoutError } from '../registry/Registry.js';
import { combineSignals, createTimeoutSignal, getErrorName, toError } from '../utils.js';
// ============================================================
// ── FixedTimeout 类 —— 固定超时策略 ──
// ============================================================
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
export class FixedTimeout {
    /** 策略名称，用于日志和监控 */
    name = 'fixed-timeout';
    /** 固定超时值（毫秒） */
    timeoutMs;
    /** 超时后是否取消 pending 操作 */
    _cancelOnTimeout;
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
    constructor(options) {
        if (!Number.isFinite(options.durationMs) || options.durationMs <= 0) {
            throw new RangeError(`FixedTimeout: durationMs must be a positive finite number, got ${options.durationMs}`);
        }
        this.timeoutMs = options.durationMs;
        this._cancelOnTimeout = options.cancelOnTimeout ?? true;
    }
    // ────────────────────────────────────────
    // 核心方法：execute
    // ────────────────────────────────────────
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
    async execute(fn, signal) {
        const startedAt = Date.now();
        // ── 前置检查：外部信号已中止 → 立即拒绝，不启动执行 ──
        if (signal?.aborted) {
            return {
                success: false,
                error: new DOMException('The operation was aborted', 'AbortError'),
                elapsedMs: 0,
            };
        }
        // ── 第 1 步：创建超时信号 ──
        const [timeoutSignal, cleanupTimeout] = createTimeoutSignal(this.timeoutMs);
        // ── 第 2 步：合并外部信号（如有） ──
        const combinedSignal = signal
            ? combineSignals([signal, timeoutSignal])
            : timeoutSignal;
        // ── 第 3 步：准备超时兜底 Promise ──
        // 当 combinedSignal 因超时而 abort 时，此 Promise reject
        const timeoutGuard = new Promise((_, reject) => {
            const onAbort = () => {
                combinedSignal.removeEventListener('abort', onAbort);
                reject(new DOMException(`Timed out after ${this.timeoutMs}ms`, 'TimeoutError'));
            };
            combinedSignal.addEventListener('abort', onAbort, { once: true });
        });
        try {
            // ── 第 4 步：竞争执行 ──
            // Promise.race 确保即使 fn 不检查 AbortSignal 也能超时
            const value = await Promise.race([fn(combinedSignal), timeoutGuard]);
            // fn 先完成 → 清理资源
            cleanupTimeout();
            const elapsedMs = Date.now() - startedAt;
            return { success: true, value, elapsedMs };
        }
        catch (err) {
            cleanupTimeout();
            const elapsedMs = Date.now() - startedAt;
            // ── 第 5 步：错误分类 ──
            return this._classifyError(err, elapsedMs);
        }
    }
    // ────────────────────────────────────────
    // reset —— 无状态重置
    // ────────────────────────────────────────
    /**
     * 重置策略状态。
     *
     * FixedTimeout 是无状态策略（超时值固定不变），
     * reset() 为空操作，仅用于满足接口约定。
     */
    reset() {
        // FixedTimeout 是无状态的，无需重置。
        // 超时值在构造时固定，不随执行变化。
    }
    // ────────────────────────────────────────
    // 内部工具方法
    // ────────────────────────────────────────
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
    _combineSignals(external, timeout) {
        // 如果外部信号已中止，直接返回外部信号
        if (external.aborted) {
            return external;
        }
        // 如果超时信号已中止，直接返回超时信号
        if (timeout.aborted) {
            return timeout;
        }
        // 优先使用 AbortSignal.any()（Node.js 20+）
        if (typeof AbortSignal.any === 'function') {
            return AbortSignal.any([external, timeout]);
        }
        // 降级方案：手动合并
        const controller = new AbortController();
        const abortMerged = () => {
            controller.abort();
        };
        external.addEventListener('abort', abortMerged, { once: true });
        timeout.addEventListener('abort', abortMerged, { once: true });
        return controller.signal;
    }
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
    _classifyError(err, elapsedMs) {
        const errName = getErrorName(err);
        // 情况 A：标准 DOMException TimeoutError
        // 由 AbortSignal.timeout() 或超时兜底触发
        if (errName === 'TimeoutError') {
            return {
                success: false,
                error: new TimeoutError(this.timeoutMs, elapsedMs),
                elapsedMs,
            };
        }
        // 情况 B：AbortError，且耗时已达到超时阈值
        // 可能是 fn 响应 AbortSignal 后抛出的 AbortError
        if (errName === 'AbortError' && elapsedMs >= this.timeoutMs - 5) {
            return {
                success: false,
                error: new TimeoutError(this.timeoutMs, elapsedMs),
                elapsedMs,
            };
        }
        // 情况 C：AbortError，但耗时远小于超时阈值
        // 说明是外部取消（调用方传入的 signal 被 abort）
        if (errName === 'AbortError') {
            return {
                success: false,
                error: toError(err),
                elapsedMs,
            };
        }
        // 情况 D：已有的 TimeoutError 实例（防御性处理）
        if (err instanceof TimeoutError) {
            return {
                success: false,
                error: err,
                elapsedMs,
            };
        }
        // 情况 E：其他异常（fn 本身的业务错误）
        return {
            success: false,
            error: toError(err),
            elapsedMs,
        };
    }
}
//# sourceMappingURL=FixedTimeout.js.map