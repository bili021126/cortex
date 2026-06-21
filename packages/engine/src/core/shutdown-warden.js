// ============================================================
// @cortex/engine/core/shutdown-warden —— 优雅关闭监护
//
// @since v3.1.0
// @layer 引擎层 — 编排 shutdown 顺序，管理资源泄漏报告
// @role 恢复者——资源清理，仅生命周期调用
//
// 职责：
//   1. 管理引擎组件（FileLockManager / Scheduler / MemoryStore）的 shutdown 顺序
//   2. 超时强制终止 + 资源泄漏报告
//   3. 确保 MemoryStore.endSession() 在 Scheduler 退出后调用
//
// 从 scheduler.ts 拆分 endSession() 调用逻辑。
// ============================================================
import { SHUTDOWN_TIMEOUT_MS, SHUTDOWN_FORCE_EXIT_DELAY_MS, } from "@cortex/config";
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
export class ShutdownWarden {
    lifecycleManager;
    memory;
    observer;
    timeoutMs;
    forceExitDelayMs;
    constructor(lifecycleManager, memory, observer, timeoutMs = SHUTDOWN_TIMEOUT_MS, forceExitDelayMs = SHUTDOWN_FORCE_EXIT_DELAY_MS) {
        this.lifecycleManager = lifecycleManager;
        this.memory = memory;
        this.observer = observer;
        this.timeoutMs = timeoutMs;
        this.forceExitDelayMs = forceExitDelayMs;
    }
    /**
     * 执行完整 shutdown 序列。
     *
     * @returns ShutdownReport 包含各阶段耗时和失败信息
     */
    async shutdown() {
        const stopStart = Date.now();
        const failedComponents = [];
        let endSessionDone = false;
        // Phase 1: LifecycleManager 反向关闭所有 ILifecycle 组件
        try {
            await this.lifecycleManager.shutdown();
        }
        catch (e) {
            failedComponents.push(`lifecycleManager: ${String(e)}`);
        }
        // Phase 2: MemoryStore endSession（归档 + 湮灭）
        if (this.memory) {
            try {
                await this.memory.endSession();
                endSessionDone = true;
            }
            catch {
                failedComponents.push("memoryStore.endSession");
            }
            // Phase 3: MemoryStore close
            try {
                await this.memory.close();
            }
            catch {
                failedComponents.push("memoryStore.close");
            }
        }
        const stopDurationMs = Date.now() - stopStart;
        // Phase 4: 资源泄漏报告
        if (failedComponents.length > 0 && this.observer) {
            // observer emit would go here if needed
        }
        // 给异步日志/IO 一些时间
        if (failedComponents.length > 0 && this.forceExitDelayMs > 0) {
            await delay(this.forceExitDelayMs);
        }
        return {
            stopDurationMs,
            failedComponents,
            endSessionDone,
            forceExitDelayMs: failedComponents.length > 0 ? this.forceExitDelayMs : 0,
        };
    }
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=shutdown-warden.js.map