// ============================================================
// @cortex/shared — 文件锁域（纯类型中枢）
//
// 仅保留类型定义（LockType, IFileLockManager, LockEntry, FileLockManagerConfig）。
// 运行时实现 InMemoryFileLockManager 已迁出 — engine 使用 FileLockManager（extends BaseLifecycle）。
// ============================================================

export enum LockType {
  Read = "read",
  Write = "write",
}

export interface IFileLockManager {
  acquire(filePath: string, lockType: LockType, ownerId: string): boolean;
  release(filePath: string, ownerId: string): void;
}

// ─── LockEntry ──────────────────────────────────────

/** 锁记录——内部追踪 */
export interface LockEntry {
  readonly filePath: string;
  readonly lockType: LockType;
  readonly ownerId: string;
  readonly acquiredAt: number;
}

// ─── FileLockManagerConfig ────────────────────

export interface FileLockManagerConfig {
  /** 锁默认超时时间（毫秒）。默认 120_000（2 分钟）。 */
  lockTimeoutMs?: number;
  /** 死锁检测回调。 */
  onDeadlockDetected?: (holder: LockEntry, requester: string, requestedPath: string) => void;
  /** 僵尸锁回收回调。 */
  onStaleLockReclaimed?: (stale: LockEntry) => void;
}
