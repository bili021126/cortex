// ============================================================
// @cortex/engine/core/file-lock-manager.ts — 文件锁管理器
//
// 提供基于文件路径的读写锁（Shared/Exclusive Locks），
// 支持超时自动回收、observer 通知、生命周期管理。
//
// 读锁（Read/Shared）：多个 holder 可同时持有同一文件
// 写锁（Write/Exclusive）：独占文件，排斥所有读锁和其他写锁
//
// @since v3.x
// @contract IFileLockManager in @cortex/shared
// ============================================================

import { LockType, PipelineEventType, PipelinePriority, type FileLockManagerConfig } from "@cortex/shared";
import { BaseLifecycle } from "@cortex/shared";
import type { IPipelineObserver } from "@cortex/shared";
import { DEFAULT_LOCK_TIMEOUT_MS } from "@cortex/config";

// ── 内部数据模型 ─────────────────────────────────────────

interface LockEntry {
  ownerId: string;
  lockType: LockType;
  acquiredAt: number; // Date.now()
}

interface FileLocks {
  path: string;
  holders: LockEntry[];
}

// ── 默认值 ───────────────────────────────────────────────

// DEFAULT_LOCK_TIMEOUT_MS 来自 @cortex/config (engine-defaults.ts)

// ── FileLockManager ──────────────────────────────────────

export class FileLockManager extends BaseLifecycle {
  /** 文件 → 锁持有者映射 */
  protected _locks = new Map<string, FileLocks>();

  /** 锁超时时间（ms） */
  protected _timeoutMs: number;

  /** 可选 observer，锁回收时通知 */
  protected _observer?: IPipelineObserver;

  /** dispose() 后拒绝所有操作 */
  protected _disposed = false;

  constructor(timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS, observer?: IPipelineObserver) {
    super();
    this._timeoutMs = timeoutMs;
    this._observer = observer;
  }

  // ── 锁操作 ────────────────────────────────────────────

  /**
   * 获取锁。
   * - 读锁：允许多个 holder 共存（只要没有写锁）
   * - 写锁：独占（没有其他读写锁时才能获取）
   */
  acquire(filePath: string, lockType: LockType, ownerId: string): boolean {
    this._ensureNotDisposed("acquire");

    const now = Date.now();
    const existing = this._locks.get(filePath);

    // 清理该文件上的过期锁
    if (existing) {
      this._cleanExpiredOnFile(existing, now);
    }

    // 重新获取（过期锁可能已被清理）
    const current = this._locks.get(filePath);

    if (lockType === LockType.Write) {
      // 写锁：文件上不能有任何其他锁
      if (current && current.holders.length > 0) {
        return false;
      }
      // 可以获取
      this._locks.set(filePath, {
        path: filePath,
        holders: [{ ownerId, lockType, acquiredAt: now }],
      });
      return true;
    }

    // 读锁
    if (lockType === LockType.Read) {
      // 如果有写锁在文件上，读锁被排斥
      if (current?.holders.some((h) => h.lockType === LockType.Write)) {
        return false;
      }
      // 可以获取
      if (!current) {
        this._locks.set(filePath, {
          path: filePath,
          holders: [{ ownerId, lockType, acquiredAt: now }],
        });
      } else {
        current.holders.push({ ownerId, lockType, acquiredAt: now });
      }
      return true;
    }

    return false;
  }

  /** 释放锁 */
  release(filePath: string, ownerId: string): void {
    this._ensureNotDisposed("release");

    const existing = this._locks.get(filePath);
    if (!existing) return;

    existing.holders = existing.holders.filter((h) => h.ownerId !== ownerId);

    if (existing.holders.length === 0) {
      this._locks.delete(filePath);
    }
  }

  /**
   * 文件是否被锁定。
   * 同时清理该文件上的过期锁。
   */
  isLocked(filePath: string): boolean {
    this._ensureNotDisposed("isLocked");

    const existing = this._locks.get(filePath);
    if (!existing) return false;

    this._cleanExpiredOnFile(existing, Date.now());

    return existing.holders.length > 0;
  }

  /** 检查特定 holder 是否持有该文件的锁 */
  holds(filePath: string, ownerId: string): boolean {
    this._ensureNotDisposed("holds");

    const existing = this._locks.get(filePath);
    if (!existing) return false;

    // 也清理过期锁以保证状态一致
    this._cleanExpiredOnFile(existing, Date.now());

    return existing.holders.some((h) => h.ownerId === ownerId);
  }

  /** 刷新锁的活跃时间（防误回收） */
  touch(filePath: string, ownerId: string): void {
    this._ensureNotDisposed("touch");

    const existing = this._locks.get(filePath);
    if (!existing) return;

    const entry = existing.holders.find((h) => h.ownerId === ownerId);
    if (entry) {
      entry.acquiredAt = Date.now();
    }
  }

  // ── 全局清理 ──────────────────────────────────────────

  /**
   * 清理所有过期锁。
   * @returns 清理的文件数量
   */
  cleanStaleLocks(): number {
    if (this._disposed) return 0;

    const now = Date.now();
    let cleanedCount = 0;

    for (const [filePath, fileLocks] of this._locks) {
      const expiredHolders = fileLocks.holders.filter(
        (h) => now - h.acquiredAt > this._timeoutMs,
      );

      if (expiredHolders.length > 0) {
        // 移除过期 holder
        fileLocks.holders = fileLocks.holders.filter(
          (h) => now - h.acquiredAt <= this._timeoutMs,
        );

        if (fileLocks.holders.length === 0) {
          this._locks.delete(filePath);
        }

        cleanedCount++;

        // 通知 observer
        if (this._observer) {
          const holderIds = expiredHolders.map((h) => h.ownerId).join(",");
          this._observer.emit({
            type: PipelineEventType.InfraFileLockExpiredReclaimed,
            priority: PipelinePriority.NORMAL,
            timestamp: Date.now(),
            payload: {
              count: expiredHolders.length,
              path: filePath,
              holders: holderIds,
              detail: `回收 ${expiredHolders.length} 个过期锁持有者: ${holderIds}`,
            },
          });
        }
      }
    }

    return cleanedCount;
  }

  // ── 生命周期 ──────────────────────────────────────────

  /** 初始化后允许锁操作 */
  protected async doInit(): Promise<void> {
    this._disposed = false;
  }

  /** 释放所有锁并标记已销毁 */
  protected doDispose(): void {
    this._disposed = true;
    this._locks.clear();
  }

  // ── 内部工具 ──────────────────────────────────────────

  /** 清理指定文件上的过期锁，过期时通知 observer */
  private _cleanExpiredOnFile(fileLocks: FileLocks, now: number): void {
    const expired = fileLocks.holders.filter(
      (h) => now - h.acquiredAt > this._timeoutMs,
    );

    if (expired.length === 0) return;

    fileLocks.holders = fileLocks.holders.filter(
      (h) => now - h.acquiredAt <= this._timeoutMs,
    );

    if (fileLocks.holders.length === 0) {
      this._locks.delete(fileLocks.path);
    }

    // 通知 observer
    if (this._observer) {
      const holderIds = expired.map((h) => h.ownerId).join(",");
      this._observer.emit({
        type: PipelineEventType.InfraFileLockExpiredReclaimed,
        priority: PipelinePriority.NORMAL,
        timestamp: Date.now(),
        payload: {
          count: expired.length,
          path: fileLocks.path,
          holders: holderIds,
          detail: `回收 ${expired.length} 个过期锁持有者: ${holderIds}`,
        },
      });
    }
  }

  /** 确保 dispose 后抛出明确错误 */
  private _ensureNotDisposed(op: string): void {
    if (this._disposed) {
      throw new Error(`[FileLockManager] 已释放，拒绝操作: ${op}`);
    }
  }
}

// ── InMemoryFileLockManager（插件适配器）───────────────────────

/**
 * InMemoryFileLockManager — 兼容 FileLockManagerConfig 接口的锁管理器。
 * 扩展 FileLockManager，增加 clear() 方法和回调桥接（死锁检测 + 僵尸锁回收）。
 * 适配 plugin/file-lock-manager.plugin.ts 的导入需求。
 *
 * @see FileLockManagerConfig in @cortex/shared
 */
export class InMemoryFileLockManager extends FileLockManager {
  private _config: FileLockManagerConfig;

  constructor(config: FileLockManagerConfig) {
    const timeoutMs = config.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    super(timeoutMs);
    this._config = config;
  }

  /**
   * 释放所有锁并重置状态。
   * 先清理过期锁（触发 onStaleLockReclaimed 回调），
   * 再清空所有持有者。
   */
  clear(): void {
    // 清理过期锁（触发回调）
    this.cleanStaleLocks();
    // 清空所有剩余锁
    this._locks.clear();
    this._disposed = true;
  }

  /**
   * 获取锁——同时检测死锁并触发 onDeadlockDetected 回调。
   */
  override acquire(filePath: string, lockType: LockType, ownerId: string): boolean {
    const result = super.acquire(filePath, lockType, ownerId);

    if (!result && this._config.onDeadlockDetected) {
      const existing = this._locks.get(filePath);
      if (existing && existing.holders.length > 0) {
        const holder = existing.holders[0];
        if (holder) {
          this._config.onDeadlockDetected(
            {
              filePath,
              lockType: holder.lockType,
              ownerId: holder.ownerId,
              acquiredAt: holder.acquiredAt,
            },
            ownerId,
            filePath,
          );
        }
      }
    }

    return result;
  }

  /**
   * 清理过期锁——同时触发 onStaleLockReclaimed 回调。
   */
  override cleanStaleLocks(): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [filePath, fileLocks] of this._locks) {
      const expiredHolders = fileLocks.holders.filter(
        (h) => now - h.acquiredAt > this._timeoutMs,
      );

      if (expiredHolders.length > 0) {
        fileLocks.holders = fileLocks.holders.filter(
          (h) => now - h.acquiredAt <= this._timeoutMs,
        );

        if (fileLocks.holders.length === 0) {
          this._locks.delete(filePath);
        }

        cleanedCount++;

        // 回调通知
        if (this._config.onStaleLockReclaimed) {
          for (const h of expiredHolders) {
            this._config.onStaleLockReclaimed({
              filePath,
              lockType: h.lockType,
              ownerId: h.ownerId,
              acquiredAt: h.acquiredAt,
            });
          }
        }

        // observer 通知
        if (this._observer) {
          const holderIds = expiredHolders.map((h) => h.ownerId).join(",");
          this._observer.emit({
            type: PipelineEventType.InfraFileLockExpiredReclaimed,
            priority: PipelinePriority.NORMAL,
            timestamp: Date.now(),
            payload: {
              count: expiredHolders.length,
              path: filePath,
              holders: holderIds,
              detail: `回收 ${expiredHolders.length} 个过期锁持有者: ${holderIds}`,
            },
          });
        }
      }
    }

    return cleanedCount;
  }
}
