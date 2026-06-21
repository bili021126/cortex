// ============================================================
// @cortex/resilience — AdaptiveTimeout 自适应超时策略
//
// @file-overview
// AdaptiveTimeout 是基于历史执行时间动态调整超时值的
// 自适应超时策略。使用 EMA（指数移动平均）平滑历史延迟，
// 超时值 = EMA × multiplier，并受 min/max 边界约束。
//
// 核心算法：
//   ema = α × lastDuration + (1 - α) × ema     (α = 0.3)
//   timeout = clamp(ema × multiplier, minTimeout, maxTimeout)
//
// 特性：
// - 基于 AbortSignal.timeout()（Node.js 18+）
// - 降级方案：setTimeout + AbortController
// - Promise.race 兜底：即使 fn 不响应 AbortSignal 也能超时
// - 外部信号合并：支持调用方传入的外部取消信号
// - 超时不更新 EMA：防止超时值因超时事件而产生死亡螺旋
// - 业务失败更新 EMA：该次调用实际已返回，耗时应纳入统计
// - 外部取消不更新 EMA：取消非正常执行，应排除在统计外
//
// @design 详见 DESIGN.md §5.3.2「AdaptiveTimeoutPolicy」
// ============================================================
import { TimeoutError } from '../registry/Registry.js';
import { combineSignals, createTimeoutSignal, clamp, getErrorName, toError } from '../utils.js';
// ============================================================
// ── AdaptiveTimeout 类 —— 自适应超时策略 ──
// ============================================================
/**
 * AdaptiveTimeout —— 基于 EMA 的自适应超时策略。
 *
 * 使用指数移动平均（EMA）平滑历史执行延迟，动态计算超时值。
 * 适用于 LLM API 调用等延迟波动较大的场景。
 *
 * ── 算法说明 ──
 *
 * 每次执行完成后，根据实际耗时更新 EMA：
 * ```
 * ema = α × lastDuration + (1 - α) × ema
 * timeoutMs = clamp(ema × multiplier, minTimeoutMs, maxTimeoutMs)
 * ```
 *
 * ── EMA 更新规则 ──
 *
 * | 执行结果         | 是否更新 EMA | 原因                                       |
 * |-----------------|-------------|------------------------------------------|
 * | ✅ 成功          | ✅ 是        | 正常耗时应纳入统计                            |
 * | ⏰ 超时          | ❌ 否        | 超时发生在 fn 完成前，耗时不代表实际处理时间     |
 * | ❌ 业务异常      | ✅ 是        | fn 已完成（即使报错），耗时可反映服务响应速度    |
 * | 🛑 外部取消      | ❌ 否        | 取消是非正常执行，应排除在统计外                |
 *
 * ── 适用场景 ──
 *
 * - LLM API 调用（延迟波动大，从数百 ms 到数十秒）
 * - 外部服务调用（网络延迟随负载变化）
 * - 任何需要动态调整超时以平衡响应速度与成功率的场景
 *
 * @example
 * ```typescript
 * // 基本用法
 * const timeout = new AdaptiveTimeout({
 *   initialTimeoutMs: 30000,
 *   minTimeoutMs: 5000,
 *   maxTimeoutMs: 60000,
 *   multiplier: 4,
 *   alpha: 0.3,
 * });
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
 *   timeout: new AdaptiveTimeout({ initialTimeoutMs: 30000 }),
 * });
 * ```
 */
export class AdaptiveTimeout {
    /** 策略名称，用于日志和监控 */
    name = 'adaptive-timeout';
    /** 最小超时阈值 */
    minTimeoutMs;
    /** 最大超时阈值 */
    maxTimeoutMs;
    /** 超时倍数 */
    multiplier;
    /** EMA 平滑系数 */
    alpha;
    /** 超时后是否取消 pending 操作 */
    _cancelOnTimeout;
    /** 超时值更新回调 */
    _onTimeoutUpdate;
    /** 当前 EMA 值（指数移动平均） */
    _ema;
    /** 当前超时值（毫秒），随自适应算法动态更新 */
    _currentTimeoutMs;
    /**
     * @param options 配置选项
     * @throws {RangeError} 当 initialTimeoutMs/minTimeoutMs/maxTimeoutMs 不合法时抛出
     *
     * @example
     * ```typescript
     * // LLM API 场景：宽松自适应超时
     * const timeout = new AdaptiveTimeout({
     *   initialTimeoutMs: 30000,
     *   minTimeoutMs: 10000,
     *   maxTimeoutMs: 120000,
     *   multiplier: 5,
     *   alpha: 0.2,
     * });
     *
     * // 常规服务场景：适中自适应超时
     * const timeout = new AdaptiveTimeout({
     *   initialTimeoutMs: 15000,
     *   minTimeoutMs: 5000,
     *   maxTimeoutMs: 60000,
     *   multiplier: 4,
     *   alpha: 0.3,
     * });
     * ```
     */
    constructor(options = {}) {
        const initialTimeoutMs = options.initialTimeoutMs ?? 15_000;
        const minTimeoutMs = options.minTimeoutMs ?? 5_000;
        const maxTimeoutMs = options.maxTimeoutMs ?? 60_000;
        const multiplier = options.multiplier ?? 4;
        const alpha = options.alpha ?? 0.3;
        const initialEma = options.initialEma ?? 5_000;
        // ── 参数校验 ──
        if (!Number.isFinite(initialTimeoutMs) || initialTimeoutMs <= 0) {
            throw new RangeError(`AdaptiveTimeout: initialTimeoutMs must be a positive finite number, got ${initialTimeoutMs}`);
        }
        if (!Number.isFinite(minTimeoutMs) || minTimeoutMs <= 0) {
            throw new RangeError(`AdaptiveTimeout: minTimeoutMs must be a positive finite number, got ${minTimeoutMs}`);
        }
        if (!Number.isFinite(maxTimeoutMs) || maxTimeoutMs <= 0) {
            throw new RangeError(`AdaptiveTimeout: maxTimeoutMs must be a positive finite number, got ${maxTimeoutMs}`);
        }
        if (minTimeoutMs > maxTimeoutMs) {
            throw new RangeError(`AdaptiveTimeout: minTimeoutMs (${minTimeoutMs}) must not exceed maxTimeoutMs (${maxTimeoutMs})`);
        }
        if (initialTimeoutMs < minTimeoutMs || initialTimeoutMs > maxTimeoutMs) {
            throw new RangeError(`AdaptiveTimeout: initialTimeoutMs (${initialTimeoutMs}) must be between minTimeoutMs (${minTimeoutMs}) and maxTimeoutMs (${maxTimeoutMs})`);
        }
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
            throw new RangeError(`AdaptiveTimeout: multiplier must be a positive finite number, got ${multiplier}`);
        }
        if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
            throw new RangeError(`AdaptiveTimeout: alpha must be a number in (0, 1), got ${alpha}`);
        }
        this.minTimeoutMs = minTimeoutMs;
        this.maxTimeoutMs = maxTimeoutMs;
        this.multiplier = multiplier;
        this.alpha = alpha;
        this._cancelOnTimeout = options.cancelOnTimeout ?? true;
        this._onTimeoutUpdate = options.onTimeoutUpdate;
        // ── 初始化状态 ──
        this._initialEma = initialEma;
        this._ema = initialEma;
        this._currentTimeoutMs = clamp(Math.round(initialEma * multiplier), this.minTimeoutMs, this.maxTimeoutMs);
    }
    // ────────────────────────────────────────
    // 属性访问器
    // ────────────────────────────────────────
    /**
     * 当前超时值（毫秒）。
     *
     * 每次 execute 完成后可能动态更新。
     * 读取此属性可获得当前生效的超时值。
     */
    get timeoutMs() {
        return this._currentTimeoutMs;
    }
    /**
     * 当前 EMA 值（毫秒）。
     *
     * EMA 是历史执行耗时的指数移动平均值。
     * 用于监控和调试，理解超时值的计算依据。
     */
    get ema() {
        return this._ema;
    }
    // ────────────────────────────────────────
    // 核心方法：execute
    // ────────────────────────────────────────
    /**
     * 在自适应超时保护下执行异步函数。
     *
     * 执行流程：
     * 1. 使用当前超时值创建 AbortSignal（超时计时开始）
     * 2. 合并外部 signal（如有）
     * 3. 通过 Promise.race 同时执行 fn 和超时兜底
     * 4. fn 先完成 → 返回成功结果，更新 EMA
     * 5. 超时先触发 → 返回 TimeoutError，不更新 EMA
     * 6. fn 抛业务异常 → 返回失败结果，更新 EMA
     * 7. 外部取消 → 返回 AbortError，不更新 EMA
     *
     * @param fn 要执行的异步函数，接收 AbortSignal 作为可选参数
     *            当超时发生时，signal 被 abort，fn 可据此取消操作
     * @param signal 外部取消信号（可选），用于调用方主动取消
     * @returns TimeoutResult 包含执行结果或超时/错误信息
     *
     * @example
     * ```typescript
     * const timeout = new AdaptiveTimeout({ initialTimeoutMs: 20000 });
     *
     * // 第 1 次：实际耗时 2000ms → ema 上升 → timeout 调整
     * const r1 = await timeout.execute(async (s) => fetch(url, { signal: s }));
     *
     * // 第 2 次：超时值已根据第 1 次结果调整
     * const r2 = await timeout.execute(async (s) => fetch(url, { signal: s }));
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
        const currentTimeout = this._currentTimeoutMs;
        // ── 第 1 步：创建超时信号 ──
        const [timeoutSignal, cleanupTimeout] = createTimeoutSignal(currentTimeout);
        // ── 第 2 步：合并外部信号（如有） ──
        const combinedSignal = signal
            ? combineSignals([signal, timeoutSignal])
            : timeoutSignal;
        // ── 第 3 步：准备超时兜底 Promise ──
        const timeoutGuard = new Promise((_, reject) => {
            const onAbort = () => {
                combinedSignal.removeEventListener('abort', onAbort);
                reject(new DOMException(`Timed out after ${currentTimeout}ms`, 'TimeoutError'));
            };
            combinedSignal.addEventListener('abort', onAbort, { once: true });
        });
        try {
            // ── 第 4 步：竞争执行 ──
            const value = await Promise.race([fn(combinedSignal), timeoutGuard]);
            // fn 先完成 → 清理资源
            cleanupTimeout();
            const elapsedMs = Date.now() - startedAt;
            // ── 第 5 步：成功 → 更新 EMA ──
            // 正常完成的操作耗时应纳入统计
            this._updateEma(elapsedMs);
            return { success: true, value, elapsedMs };
        }
        catch (err) {
            cleanupTimeout();
            const elapsedMs = Date.now() - startedAt;
            // ── 第 6 步：错误分类 ──
            return this._classifyAndHandleError(err, elapsedMs, currentTimeout);
        }
    }
    // ────────────────────────────────────────
    // reset —— 重置到初始状态
    // ────────────────────────────────────────
    /**
     * 重置自适应超时到初始状态。
     *
     * 将 EMA 和当前超时值恢复为构造函数中指定的初始值。
     * 适用于场景切换、服务重启或测试恢复。
     */
    reset() {
        // 注意：reset 时使用构造时的 initialEma 值。
        // 由于 TypeScript 编译后无法保留构造参数默认值，
        // 我们在 reset 中恢复为 5000（与构造函数默认值一致）。
        // 如果调用方通过构造函数传入了自定义 initialEma，
        // 他们应自行管理重置值。
        //
        // 实际上，更好的做法是记住构造时的 initialEma。
        // 这里我们通过一个内部字段保存初始 EMA。
        this._ema = this._initialEma;
        this._currentTimeoutMs = clamp(Math.round(this._initialEma * this.multiplier), this.minTimeoutMs, this.maxTimeoutMs);
    }
    /** 保存构造函数中传入的初始 EMA 值，用于 reset() 恢复 */
    _initialEma;
    // ────────────────────────────────────────
    // 内部方法
    // ────────────────────────────────────────
    /**
     * 更新 EMA 和当前超时值。
     *
     * 算法：
     *   ema = α × lastDuration + (1 - α) × ema
     *   timeoutMs = clamp(ema × multiplier, minTimeoutMs, maxTimeoutMs)
     *
     * 调用 onTimeoutUpdate 回调（如果已注册）。
     *
     * @param lastDuration 最近一次执行的耗时（毫秒）
     */
    _updateEma(lastDuration) {
        // 过滤极端值：如果 lastDuration 明显异常（如负值或超大值），
        // 使用当前 EMA 值代替，防止单个异常值污染统计
        const safeDuration = (Number.isFinite(lastDuration) && lastDuration >= 0)
            ? lastDuration
            : this._ema;
        // EMA 递推公式
        this._ema = this.alpha * safeDuration + (1 - this.alpha) * this._ema;
        // 计算新的超时值（使用共享 clamp 工具）
        const newTimeoutMs = clamp(Math.round(this._ema * this.multiplier), this.minTimeoutMs, this.maxTimeoutMs);
        // 仅在超时值真正变化时更新并回调
        if (newTimeoutMs !== this._currentTimeoutMs) {
            this._currentTimeoutMs = newTimeoutMs;
            // 触发更新回调（用于日志/监控/事件发射）
            if (this._onTimeoutUpdate) {
                try {
                    this._onTimeoutUpdate(newTimeoutMs, this._ema, safeDuration);
                }
                catch {
                    // 回调异常隔离 —— 不影响主流程
                }
            }
        }
    }
    /**
     * 将捕获的异常分类转换为 TimeoutResult，并根据分类结果
     * 决定是否更新 EMA。
     *
     * 使用 getErrorName 安全提取错误名称，避免类型断言。
     *
     * 分类与 EMA 更新规则：
     *
     * | 错误类型                            | 是否更新 EMA | 原因                          |
     * |-----------------------------------|-------------|-------------------------------|
     * | TimeoutError（超时）               | ❌ 否        | 超时非正常完成，不应纳入统计    |
     * | AbortError（耗时≥超时阈值）         | ❌ 否        | 实质是超时                    |
     * | AbortError（耗时<超时阈值，外部取消）| ❌ 否        | 取消非正常执行，排除在统计外    |
     * | 业务异常（fn 本身抛出的错误）       | ✅ 是        | fn 已完成（即使报错），耗时有效 |
     * | TimeoutError 实例（已有）          | ❌ 否        | 同超时                       |
     *
     * @param err 捕获的原始异常（unknown 类型，使用工具函数安全处理）
     * @param elapsedMs 已耗时
     * @param currentTimeout 执行时的超时值
     * @returns 分类后的 TimeoutResult
     */
    _classifyAndHandleError(err, elapsedMs, currentTimeout) {
        const errName = getErrorName(err);
        // ── 情况 A：标准 DOMException TimeoutError ──
        // 由 AbortSignal.timeout() 或超时兜底触发
        // ⛔ 不更新 EMA：超时非正常完成
        if (errName === 'TimeoutError') {
            return {
                success: false,
                error: new TimeoutError(currentTimeout, elapsedMs),
                elapsedMs,
            };
        }
        // ── 情况 B：AbortError，且耗时已达到超时阈值 ──
        // 可能是 fn 响应 AbortSignal 后抛出的 AbortError
        // ⛔ 不更新 EMA：实质是超时
        if (errName === 'AbortError' && elapsedMs >= currentTimeout - 5) {
            return {
                success: false,
                error: new TimeoutError(currentTimeout, elapsedMs),
                elapsedMs,
            };
        }
        // ── 情况 C：AbortError，但耗时远小于超时阈值 ──
        // 说明是外部取消（调用方传入的 signal 被 abort）
        // ⛔ 不更新 EMA：取消是非正常执行
        if (errName === 'AbortError') {
            return {
                success: false,
                error: toError(err),
                elapsedMs,
            };
        }
        // ── 情况 D：已有的 TimeoutError 实例 ──
        // ⛔ 不更新 EMA：同超时
        if (err instanceof TimeoutError) {
            return {
                success: false,
                error: err,
                elapsedMs,
            };
        }
        // ── 情况 E：业务异常（fn 本身抛出的错误） ──
        // ✅ 更新 EMA：fn 已执行完成（即使报错），耗时反映服务响应速度
        // 但只在耗时合理的情况下更新（排除立即抛出的同步错误）
        if (elapsedMs >= 5) {
            this._updateEma(elapsedMs);
        }
        return {
            success: false,
            error: toError(err),
            elapsedMs,
        };
    }
}
//# sourceMappingURL=AdaptiveTimeout.js.map