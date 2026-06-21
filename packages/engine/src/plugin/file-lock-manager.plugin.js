// ============================================================
// @cortex/engine/plugin/file-lock-manager.plugin
//
// FileLockManager 插件——无外部依赖。
// 进程内读写锁管理：写锁互斥、读锁共享、超时回收、死锁检测。
// Tool 接口中 needsLock=true 的工具调用前通过此插件获取锁。
//
// @since Core-2 — 文件锁管理器插件化
// ============================================================
import { InMemoryFileLockManager, } from "@cortex/shared";
import { PipelineEventType, PipelinePriority } from "@cortex/shared";
import { DEFAULT_LOCK_TIMEOUT_MS } from "@cortex/config";
export class FileLockManagerPlugin {
    name = "fileLockManager";
    dependencies = [];
    instance;
    async init(ctx) {
        this.instance = new InMemoryFileLockManager({
            lockTimeoutMs: ctx.config.toolTimeouts?.confirmWait
                ? ctx.config.toolTimeouts.confirmWait * 2 // 锁超时为确认超时两倍
                : DEFAULT_LOCK_TIMEOUT_MS,
            // 死锁检测 → PipelineObserver 告警
            onDeadlockDetected: (holder, requester, requestedPath) => {
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
            onStaleLockReclaimed: (stale) => {
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
    async start() { }
    async stop() {
        this.instance.clear();
    }
    health() {
        return this.instance ? "healthy" : "dead";
    }
    getInstance() {
        return this.instance;
    }
}
//# sourceMappingURL=file-lock-manager.plugin.js.map