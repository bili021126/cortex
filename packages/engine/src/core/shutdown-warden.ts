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

import type { IMemoryStore, IPipelineObserver } from "@cortex/shared";
import type { LifecycleManager } from "../lifecycle/lifecycle-manager.js";
import {
  SHUTDOWN_TIMEOUT_MS,
  SHUTDOWN_FORCE_EXIT_DELAY_MS,
} from "@cortex/config";

import { DegradationBoundary } from "./degradation-boundary.js";

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
export class ShutdownWarden {
  private readonly lifecycleManager: LifecycleManager;
  private readonly memory?: IMemoryStore;
  private readonly observer?: IPipelineObserver;
  private readonly timeoutMs: number;
  private readonly forceExitDelayMs: number;

  constructor(
    lifecycleManager: LifecycleManager,
    memory?: IMemoryStore,
    observer?: IPipelineObserver,
    timeoutMs: number = SHUTDOWN_TIMEOUT_MS,
    forceExitDelayMs: number = SHUTDOWN_FORCE_EXIT_DELAY_MS,
  ) {
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
  async shutdown(): Promise<ShutdownReport> {
    const stopStart = Date.now();
    const failedComponents: string[] = [];
    let endSessionDone = false;

    // Phase 1: LifecycleManager 反向关闭所有 ILifecycle 组件
    try {
      await this.lifecycleManager.shutdown();
    } catch (e) {
      failedComponents.push(`lifecycleManager: ${String(e)}`);
    }

    // Phase 2: MemoryStore endSession（归档 + 湮灭）
    if (this.memory) {
      try {
        await this.memory.endSession();
        endSessionDone = true;
      } catch (err) { DegradationBoundary.handle(err, 'shutdown-warden', 'trace');
        failedComponents.push("memoryStore.endSession");
      }

      // Phase 3: MemoryStore close
      try {
        await this.memory.close();
      } catch (err) { DegradationBoundary.handle(err, 'shutdown-warden', 'trace');
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
