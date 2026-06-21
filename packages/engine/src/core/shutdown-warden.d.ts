import type { IMemoryStore, IPipelineObserver } from "@cortex/shared";
import type { LifecycleManager } from "../lifecycle/lifecycle-manager.js";
/** Shutdown 阶段报告 */
export interface ShutdownReport {
    /** stop 阶段耗时 (ms) */
    stopDurationMs: number;
    /** 未正常关闭的组件 */
    failedComponents: string[];
    /** endSession 是否成功 */
    endSessionDone: boolean;
    /** 强制退出延迟 (ms) */
    forceExitDelayMs: number;
}
/**
 * ShutdownWarden —— 引擎优雅关闭监护。
 *
 * 编排 shutdown 顺序：
 *   1. Scheduler 完成进行中的任务
 *   2. LifecycleManager.shutdown() — 反向 stop + dispose 所有 ILifecycle 组件
 *   3. MemoryStore.endSession() — 归档 Active 记忆，湮灭 Pending 记忆
 *   4. MemoryStore.close() — 释放存储连接
 *   5. 资源泄漏报告
 *
 * @example
 * ```typescript
 * const warden = new ShutdownWarden(lifecycleManager, memory, observer);
 * const report = await warden.shutdown();
 * ```
 */
export declare class ShutdownWarden {
    private readonly lifecycleManager;
    private readonly memory?;
    private readonly observer?;
    private readonly timeoutMs;
    private readonly forceExitDelayMs;
    constructor(lifecycleManager: LifecycleManager, memory?: IMemoryStore, observer?: IPipelineObserver, timeoutMs?: number, forceExitDelayMs?: number);
    /**
     * 执行完整 shutdown 序列。
     *
     * @returns ShutdownReport 包含各阶段耗时和失败信息
     */
    shutdown(): Promise<ShutdownReport>;
}
//# sourceMappingURL=shutdown-warden.d.ts.map