import { LockType } from "@cortex/shared";
import { BaseLifecycle } from "@cortex/shared";
import type { IPipelineObserver } from "@cortex/shared";
export declare class FileLockManager extends BaseLifecycle {
    /** 文件 → 锁持有者映射 */
    private _locks;
    /** 锁超时时间（ms） */
    private _timeoutMs;
    /** 可选 observer，锁回收时通知 */
    private _observer?;
    /** dispose() 后拒绝所有操作 */
    private _disposed;
    constructor(timeoutMs?: number, observer?: IPipelineObserver);
    /**
     * 获取锁。
     * - 读锁：允许多个 holder 共存（只要没有写锁）
     * - 写锁：独占（没有其他读写锁时才能获取）
     */
    acquire(filePath: string, lockType: LockType, ownerId: string): boolean;
    /** 释放锁 */
    release(filePath: string, ownerId: string): void;
    /**
     * 文件是否被锁定。
     * 同时清理该文件上的过期锁。
     */
    isLocked(filePath: string): boolean;
    /** 检查特定 holder 是否持有该文件的锁 */
    holds(filePath: string, ownerId: string): boolean;
    /** 刷新锁的活跃时间（防误回收） */
    touch(filePath: string, ownerId: string): void;
    /**
     * 清理所有过期锁。
     * @returns 清理的文件数量
     */
    cleanStaleLocks(): number;
    /** 初始化后允许锁操作 */
    protected doInit(): Promise<void>;
    /** 释放所有锁并标记已销毁 */
    protected doDispose(): void;
    /** 清理指定文件上的过期锁，过期时通知 observer */
    private _cleanExpiredOnFile;
    /** 确保 dispose 后抛出明确错误 */
    private _ensureNotDisposed;
}
//# sourceMappingURL=file-lock-manager.d.ts.map