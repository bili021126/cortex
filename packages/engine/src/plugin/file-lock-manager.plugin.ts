// ============================================================
// @cortex/engine/plugin/file-lock-manager.plugin
//
// FileLockManager 插件——无外部依赖。
// 进程内读写锁管理：写锁互斥、读锁共享、超时回收、死锁检测。
// Tool 接口中 needsLock=true 的工具调用前通过此插件获取锁。
//
// @since Core-2 — 文件锁管理器插件化
// ============================================================

import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import {
  type IFileLockManager,
  type LockEntry,
} from "@cortex/shared";
import { InMemoryFileLockManager } from "../core/file-lock-manager.js";
import { PipelineEventType, PipelinePriority } from "@cortex/shared";
import { DEFAULT_LOCK_TIMEOUT_MS } from "@cortex/config";

export class FileLockManagerPlugin implements EnginePlugin {
  readonly name = "fileLockManager";
  readonly dependencies: string[] = [];

  private instance!: InMemoryFileLockManager;

  async init(ctx: PluginContext): Promise<void> {
    this.instance = new InMemoryFileLockManager({
      lockTimeoutMs: ctx.config.toolTimeouts?.confirmWait
        ? ctx.config.toolTimeouts.confirmWait * 2 // 锁超时为确认超时两倍
        : DEFAULT_LOCK_TIMEOUT_MS,

      // 死锁检测 → PipelineObserver 告警
      onDeadlockDetected: (holder: LockEntry, requester: string, requestedPath: string) => {
        ctx.observer.emit({
          type: PipelineEventType.InfraComponentDegraded,
          priority: PipelinePriority.HIGH,
          payload: {
            component: "FileLockManager",
            operation: "acquire",
            detail: `死锁检测: ${requester} 请求 ${requestedPath}，已被 ${holder.ownerId} 持有`,
          },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      },

      // 僵尸锁回收 → PipelineObserver 通知
      onStaleLockReclaimed: (stale: LockEntry) => {
        ctx.observer.emit({
          type: PipelineEventType.InfraFileLockExpiredReclaimed,
          priority: PipelinePriority.NORMAL,
          payload: {
            count: 1,
            path: stale.filePath,
            holders: stale.ownerId,
            detail: `锁超时回收: ${stale.filePath} (${stale.ownerId}, ${stale.lockType})`,
          },
          timestamp: Date.now(),
          notificationType: "FYI",
        });
      },
    });
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    // 生命周期级 teardown：dispose() 释放锁并标记已销毁（use-after-stop 守卫）
    this.instance.dispose();
  }

  health(): PluginHealth {
    return this.instance ? "healthy" : "dead";
  }

  getInstance(): IFileLockManager {
    return this.instance;
  }
}


