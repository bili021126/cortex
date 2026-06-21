import { type ITimeoutPolicy, type TimeoutResult } from '../registry/Registry.js';
/**
 * AdaptiveTimeoutOptions —— 自适应超时策略的配置选项。
 *
 * @remarks
 * 配置项分为三类：
 * 1. **超时边界**：minTimeoutMs / maxTimeoutMs —— 限制超时值范围
 * 2. **算法参数**：multiplier / alpha —— 控制 EMA 行为和超时宽松度
 * 3. **初始状态**：initialTimeoutMs / initialEma —— 冷启动时的初始值
 * 4. **行为控制**：cancelOnTimeout / onTimeoutUpdate —— 超时行为与监控
 */
export interface AdaptiveTimeoutOptions {
    /**
     * 初始超时值（毫秒）。
     * 同时也是冷启动阶段的超时值，直到 EMA 收敛。
     * 必须为正整数。
     *
     * @default 15000
     */
    readonly initialTimeoutMs?: number;
    /**
     * 最小超时阈值（毫秒）。
     * 自适应超时值永远不会低于此值，防止超时过短导致频繁误判。
     *
     * @default 5000
     */
    readonly minTimeoutMs?: number;
    /**
     * 最大超时阈值（毫秒）。
     * 自适应超时值永远不会高于此值，防止超时过长导致等待太久。
     *
     * @default 60000
     */
    readonly maxTimeoutMs?: number;
    /**
     * 超时倍数。
     * 超时值 = EMA × multiplier。
     * multiplier 越大，超时越宽松（容忍更大延迟波动）；
     * multiplier 越小，超时越严格（更早触发超时）。
     *
     * 推荐值：3.0 ~ 5.0
     * - 3.0：较严格，适合延迟稳定的服务
     * - 4.0：适中（默认），平衡容忍度与响应性
     * - 5.0：较宽松，适合延迟波动大的服务
     *
     * @default 4
     */
    readonly multiplier?: number;
    /**
     * EMA 平滑系数（α）。
     * 控制历史权重 vs 新样本权重。
     * α 越大，新样本权重越大（响应更快，但易受偶发波动影响）；
     * α 越小，历史权重越大（更平滑，但对变化响应较慢）。
     *
     * 推荐值：0.1 ~ 0.5
     * - 0.1：高度平滑，对变化不敏感
     * - 0.3：适中（默认），兼顾平滑与响应
     * - 0.5：响应迅速，但易受噪声影响
     *
     * @default 0.3
     */
    readonly alpha?: number;
    /**
     * 初始 EMA 值（毫秒）。
     * 在尚无历史数据时使用的 EMA 初始值。
     * 通常设为预期的平均延迟值。
     *
     * @default 5000
     */
    readonly initialEma?: number;
    /**
     * 超时后是否取消 pending 操作。
     * - true（默认）：超时后通过 AbortSignal 通知 fn 取消
     * - false：超时后仅返回 TimeoutResult，不主动取消
     *
     * @default true
     */
    readonly cancelOnTimeout?: boolean;
    /**
     * 超时值更新回调。
     * 每当自适应算法计算出新的超时值时调用。
     * 可用于日志、监控或发射 ADAPTIVE_TIMEOUT_UPDATE 事件。
     *
     * @param newTimeoutMs 更新后的超时值（毫秒）
     * @param ema 当前的 EMA 值（毫秒）
     * @param lastDuration 最近一次执行耗时（毫秒）
     *
     * @example
     * ```typescript
     * onTimeoutUpdate: (newTimeoutMs, ema, lastDuration) => {
     *   logger.debug(`超时值更新: ${newTimeoutMs}ms (EMA=${ema}, last=${lastDuration})`);
     * }
     * ```
     */
    readonly onTimeoutUpdate?: (newTimeoutMs: number, ema: number, lastDuration: number) => void;
}
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
export declare class AdaptiveTimeout implements ITimeoutPolicy {
    /** 策略名称，用于日志和监控 */
    readonly name = "adaptive-timeout";
    /** 最小超时阈值 */
    readonly minTimeoutMs: number;
    /** 最大超时阈值 */
    readonly maxTimeoutMs: number;
    /** 超时倍数 */
    readonly multiplier: number;
    /** EMA 平滑系数 */
    readonly alpha: number;
    /** 超时后是否取消 pending 操作 */
    private readonly _cancelOnTimeout;
    /** 超时值更新回调 */
    private readonly _onTimeoutUpdate?;
    /** 当前 EMA 值（指数移动平均） */
    private _ema;
    /** 当前超时值（毫秒），随自适应算法动态更新 */
    private _currentTimeoutMs;
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
    constructor(options?: AdaptiveTimeoutOptions);
    /**
     * 当前超时值（毫秒）。
     *
     * 每次 execute 完成后可能动态更新。
     * 读取此属性可获得当前生效的超时值。
     */
    get timeoutMs(): number;
    /**
     * 当前 EMA 值（毫秒）。
     *
     * EMA 是历史执行耗时的指数移动平均值。
     * 用于监控和调试，理解超时值的计算依据。
     */
    get ema(): number;
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
    execute<T>(fn: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<TimeoutResult<T>>;
    /**
     * 重置自适应超时到初始状态。
     *
     * 将 EMA 和当前超时值恢复为构造函数中指定的初始值。
     * 适用于场景切换、服务重启或测试恢复。
     */
    reset(): void;
    /** 保存构造函数中传入的初始 EMA 值，用于 reset() 恢复 */
    private readonly _initialEma;
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
    private _updateEma;
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
    private _classifyAndHandleError;
}
//# sourceMappingURL=AdaptiveTimeout.d.ts.map