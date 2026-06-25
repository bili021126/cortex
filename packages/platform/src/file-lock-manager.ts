// ============================================================
// @cortex/platform/core/file-lock-manager.ts — 文件锁管理器
//
// 提供基于文件路径的读写锁（Shared/Exclusive Locks），
// 支持超时自动回收、observer 通知、生命周期管理。
//
// 读锁（Read/Shared）：多个 holder 可同时持有同一文件
// 写锁（Write/Exclusive）：独占文件，排斥所有读锁和其他写锁
//
// @since v3.x — 原始位于 @cortex/engine/core
// @since v2.7 — 横向解耦：迁入 @cortex/platform
// @contract IFileLockManager in @cortex/shared
// ============================================================

import { LockType, PipelineEventType, PipelinePriority, LifecyclePhase } from "@cortex/shared";
import { BaseLifecycle } from "@cortex/shared";
import type { IPipelineObserver } from "@cortex/shared";

// ── 内部数据模型 ─────────────────────────────────────────

interface LockEntry {
  holderId: string;
  type: LockType;
  acquiredAt: number;
  expiresAt: number;
}

interface FileLocks {
  readLocks: LockEntry[];
  writeLock: LockEntry | null;
  pending: LockEntry[];
}

// ── FileLockManager ──────────────────────────────────────

/** 锁选项——调用方可指定类型和超时 */
export interface LockOptions {
  type?: LockType;
  /** 锁持有超时（毫秒）——超出则自动释放 */
  timeoutMs?: number;
}

/** 锁释放原因 */
export type ReleaseReason = "completed" | "timeout_expired" | "lifecycle_shutdown" | "force_released";

/** 锁释放事件 */
export interface LockReleasedEvent {
  filePath: string;
  holderId: string;
  lockType: LockType;
  ownedTimeMs: number;
  reason: ReleaseReason;
}

/**
 * FileLockManager —— 文件路径级悲观锁。
 *
 * - 死锁预防：超时自动释放 + 有序获取
 * - 可观测：通过 observer 上报所有锁释放事件
 * - 生命周期：继承 BaseLifecycle，init/dispose 管理内部状态
 * - 清理：staleLockCleanup 周期性清除过期锁
 *
 * @example
 * ```typescript
 * const flm = new FileLockManager();
 * flm.init();
 *
 * // 写锁——独占
 * const lock = flm.acquire("/path/to/file.lock", "writer-1", LockType.Write);
 * // ... do write ...
 * flm.release("/path/to/file.lock", "writer-1");
 * ```
 */
export class FileLockManager extends BaseLifecycle {
  private _locks: Map<string, FileLocks> = new Map();
  private _cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private _observer: IPipelineObserver | null = null;
  private _defaultTimeoutMs: number;

  // ── 公开状态 ──────────────────────────────────────────
  readonly name = "FileLockManager";

  // 兼容性的属性代理——保持与 v3.x API 一致
  get lockTimeoutMs(): number { return this._defaultTimeoutMs; }

  constructor(defaultTimeoutMs: number = 30_000, observer?: IPipelineObserver) {
    super();
    this._defaultTimeoutMs = defaultTimeoutMs;
    this._observer = observer ?? null;
  }

  // ── 生命周期 ──────────────────────────────────────────

  protected async doInit(): Promise<void> {
    this._cleanupTimer = setInterval(() => this._cleanupStaleLocks(), 1000);
  }

  protected doDispose(): void {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    // 释放所有锁
    for (const [filePath, locks] of this._locks) {
      if (locks.writeLock) {
        this._emitRelease(filePath, locks.writeLock.holderId, LockType.Write, "lifecycle_shutdown");
      }
      for (const lock of locks.readLocks) {
        this._emitRelease(filePath, lock.holderId, LockType.Read, "lifecycle_shutdown");
      }
    }
    this._locks.clear();
  }

  // ── 状态查询 ──────────────────────────────────────────

  get size(): number {
    let count = 0;
    for (const [, locks] of this._locks) {
      if (locks.writeLock) count++;
      count += locks.readLocks.length;
    }
    return count;
  }

  /** 查询指定文件是否存在写锁 */
  isWriteLocked(filePath: string): boolean {
    return this._locks.get(filePath)?.writeLock !== undefined;
  }

  /** 查询指定文件是否存在读锁 */
  isReadLocked(filePath: string): boolean {
    return (this._locks.get(filePath)?.readLocks.length ?? 0) > 0;
  }

  /** 查询指定文件的锁持有者列表 */
  getHolders(filePath: string): string[] {
    const locks = this._locks.get(filePath);
    if (!locks) return [];
    const holders: string[] = [];
    if (locks.writeLock) holders.push(`write:${locks.writeLock.holderId}`);
    for (const lock of locks.readLocks) holders.push(`read:${lock.holderId}`);
    return holders;
  }

  // ── 锁操作 ────────────────────────────────────────────

  /**
   * 获取指定文件的锁。
   *
   * @returns true = 成功获取，false = 未获得锁（冲突或超时）
   */
  acquire(filePath: string, holderId: string, lockType: LockType = LockType.Write, timeoutMs?: number): boolean {
    if (this.phase !== LifecyclePhase.Running) return false;

    const opts: LockOptions = { type: lockType, timeoutMs };
    const now = Date.now();
    const timeout = opts.timeoutMs ?? this._defaultTimeoutMs;

    let locks = this._locks.get(filePath);
    if (!locks) {
      locks = { readLocks: [], writeLock: null, pending: [] };
      this._locks.set(filePath, locks);
    }

    const entry: LockEntry = {
      holderId,
      type: lockType,
      acquiredAt: now,
      expiresAt: now + timeout,
    };

    if (lockType === LockType.Write) {
      if (locks.writeLock) return false; // 已有写锁
      if (locks.readLocks.length > 0) return false; // 存在活跃读锁
      // 写锁检查 Pending 队列
      if (locks.pending.length > 0) return false;
      locks.writeLock = entry;
      return true;
    }

    // 读锁（LockType.Read）
    if (locks.writeLock) return false; // 写锁持有中，拒绝新读锁
    locks.readLocks.push(entry);
    return true;
  }

  /** 释放锁 */
  release(filePath: string, holderId: string): boolean {
    const locks = this._locks.get(filePath);
    if (!locks) return false;

    const now = Date.now();

    // 检查写锁
    if (locks.writeLock?.holderId === holderId) {
      const ownedTimeMs = now - locks.writeLock.acquiredAt;
      this._emitRelease(filePath, holderId, LockType.Write, "completed");
      locks.writeLock = null;
      // 通知超时锁
      this._emitLockStats(filePath, LockType.Write, ownedTimeMs);
      return true;
    }

    // 检查读锁
    const idx = locks.readLocks.findIndex((e) => e.holderId === holderId);
    if (idx >= 0) {
      const [removed] = locks.readLocks.splice(idx, 1);
      const ownedTimeMs = now - removed!.acquiredAt;
      this._emitRelease(filePath, holderId, LockType.Read, "completed");
      this._emitLockStats(filePath, LockType.Read, ownedTimeMs);
      return true;
    }

    return false;
  }

  // ── 内部 ──────────────────────────────────────────────

  /** 清理过期锁 */
  private _cleanupStaleLocks(): void {
    const now = Date.now();
    const staleFiles: string[] = [];

    for (const [filePath, locks] of this._locks) {
      if (locks.writeLock && now >= locks.writeLock.expiresAt) {
        this._emitRelease(filePath, locks.writeLock.holderId, LockType.Write, "timeout_expired");
        locks.writeLock = null;
      }

      // 清理过期读锁
      locks.readLocks = locks.readLocks.filter((lock) => {
        const expired = now >= lock.expiresAt;
        if (expired) {
          this._emitRelease(filePath, lock.holderId, LockType.Read, "timeout_expired");
        }
        return !expired;
      });

      // 清理空锁记录
      if (!locks.writeLock && locks.readLocks.length === 0) {
        staleFiles.push(filePath);
      }
    }

    for (const filePath of staleFiles) {
      this._locks.delete(filePath);
    }
  }

  /** 发射锁释放事件 */
  private _emitRelease(filePath: string, holderId: string, lockType: LockType, reason: ReleaseReason): void {
    this._observer?.emit({
      type: PipelineEventType.InfraFileLockExpiredReclaimed,
      priority: PipelinePriority.NORMAL,
      payload: { filePath, holderId, lockType, reason },
      timestamp: Date.now(),
    });
  }

  /** 发射锁统计事件 */
  private _emitLockStats(filePath: string, lockType: LockType, heldMs: number): void {
    this._observer?.emit({
      type: PipelineEventType.InfraFileLockExpiredReclaimed,
      priority: PipelinePriority.NORMAL,
      payload: { filePath, lockType, heldMs },
      timestamp: Date.now(),
    });
  }

  /** 强制释放——供 ShutdownWarden 调用 */
  forceRelease(filePath: string): void {
    const locks = this._locks.get(filePath);
    if (!locks) return;
    if (locks.writeLock) {
      this._emitRelease(filePath, locks.writeLock.holderId, LockType.Write, "force_released");
      locks.writeLock = null;
    }
    for (const lock of locks.readLocks) {
      this._emitRelease(filePath, lock.holderId, LockType.Read, "force_released");
    }
    locks.readLocks = [];
    this._locks.delete(filePath);
  }
}
