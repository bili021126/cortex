// ============================================================
// @cortex/shared — 文件锁域
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

// ─── InMemoryFileLockManager 配置 ────────────────────

export interface FileLockManagerConfig {
  /**
   * 锁默认超时时间（毫秒）。超过此时间未释放的锁视为僵尸锁，
   * 后续 acquire() 可强行回收。默认 120_000（2 分钟）。
   */
  lockTimeoutMs?: number;

  /**
   * 死锁检测回调。检测到潜在死锁（A 等 B 的锁、B 等 A 的锁）时触发。
   * 不设置则静默返回 false。
   */
  onDeadlockDetected?: (holder: LockEntry, requester: string, requestedPath: string) => void;

  /**
   * 僵尸锁回收回调。回收超时锁时触发，可用于发送 PipelineEvent。
   */
  onStaleLockReclaimed?: (stale: LockEntry) => void;
}

// ─── InMemoryFileLockManager ────────────────────────

/**
 * InMemoryFileLockManager —— 进程内存文件锁管理器。
 *
 * 特性：
 * - 文件级读写锁：写锁互斥（同文件只能有一个写者），读锁共享（多读者可共存）
 * - 锁超时回收：超过 lockTimeoutMs 的锁自动过期，防止僵尸锁永久阻塞
 * - 死锁检测：同 ownerId 对同一文件重复 acquire 视为潜在死锁，记录日志
 * - 所有权校验：仅锁持有者可 release，非持有者 release 静默忽略
 *
 * 设计约束：
 * - 单进程内使用（Node.js 事件循环保证原子性，无须 OS 级文件锁）
 * - 不跨进程——需要跨进程协调时使用 @cortex/resilience 的分布式锁
 *
 * @example
 * ```typescript
 * const lockMgr = new InMemoryFileLockManager({
 *   lockTimeoutMs: 60_000,
 *   onStaleLockReclaimed: (stale) => observer.emit({
 *     type: PipelineEventType.InfraFileLockExpiredReclaimed,
 *     priority: PipelinePriority.NORMAL,
 *     payload: { count: 1, path: stale.filePath, holders: stale.ownerId, detail: "锁超时回收" },
 *     timestamp: Date.now(),
 *     notificationType: "FYI",
 *   }),
 * });
 *
 * lockMgr.acquire("/path/to/file", LockType.Write, "agent-001");
 * // ... do work ...
 * lockMgr.release("/path/to/file", "agent-001");
 * ```
 */
export class InMemoryFileLockManager implements IFileLockManager {
  /** filePath → LockEntry（写锁）或 LockEntry[]（读锁共享） */
  private readonly _locks = new Map<string, LockEntry | LockEntry[]>();
  private readonly _config: Required<FileLockManagerConfig>;

  private static readonly DEFAULT_LOCK_TIMEOUT_MS = 120_000;

  constructor(config: FileLockManagerConfig = {}) {
    this._config = {
      lockTimeoutMs: config.lockTimeoutMs ?? InMemoryFileLockManager.DEFAULT_LOCK_TIMEOUT_MS,
      onDeadlockDetected: config.onDeadlockDetected ?? (() => {}),
      onStaleLockReclaimed: config.onStaleLockReclaimed ?? (() => {}),
    };
  }

  /**
   * 获取文件锁。
   *
   * 规则：
   * - 写锁互斥：若已有任何锁（读或写），拒绝
   * - 读锁共享：若已有读锁，允许追加；若有写锁，拒绝
   * - 超时回收：若现有锁已超时，强制回收后授予新锁
   * - 死锁检测：同一 owner 对已持有的文件再次 acquire → 触发 onDeadlockDetected
   */
  acquire(filePath: string, lockType: LockType, ownerId: string): boolean {
    // ── 清理超时锁 ──
    this._reclaimStale(filePath);

    const now = Date.now();
    const existing = this._locks.get(filePath);

    // ── 新锁 ──
    if (!existing) {
      const entry: LockEntry = { filePath, lockType, ownerId, acquiredAt: now };
      this._locks.set(filePath, entry);
      return true;
    }

    // ── 已有锁 ──
    if (Array.isArray(existing)) {
      // 多个读锁
      if (lockType === LockType.Read) {
        // 读锁共享：追加
        existing.push({ filePath, lockType, ownerId, acquiredAt: now });
        return true;
      }
      // 写锁请求但已有读锁 → 拒绝
      return false;
    }

    // 单锁（可能是写锁或单个读锁）
    if (existing.ownerId === ownerId) {
      // 同一 owner 重复 acquire → 潜在死锁
      this._config.onDeadlockDetected(existing, ownerId, filePath);
      return false;
    }

    // 已有写锁 → 拒绝任何新锁
    if (existing.lockType === LockType.Write) return false;

    // 已有单个读锁
    if (lockType === LockType.Read) {
      // 读锁共享：从单锁升级为数组
      this._locks.set(filePath, [existing, { filePath, lockType, ownerId, acquiredAt: now }]);
      return true;
    }

    // 读锁持有中，写锁请求 → 拒绝
    return false;
  }

  /**
   * 释放文件锁。
   *
   * - 仅锁持有者可释放（ownerId 不匹配则静默忽略）
   * - 读锁数组：移除匹配的 reader，若数组只剩一个则降级为单锁
   * - 释放后若该文件无锁，清理 Map 条目
   */
  release(filePath: string, ownerId: string): void {
    const existing = this._locks.get(filePath);
    if (!existing) return;

    if (Array.isArray(existing)) {
      // 多个读锁：移除匹配的
      const filtered = existing.filter((e) => e.ownerId !== ownerId);
      if (filtered.length === 0) {
        this._locks.delete(filePath);
      } else if (filtered.length === 1) {
        this._locks.set(filePath, filtered[0]);
      } else {
        this._locks.set(filePath, filtered);
      }
      return;
    }

    // 单锁：仅匹配 owner 时释放
    if (existing.ownerId === ownerId) {
      this._locks.delete(filePath);
    }
  }

  /** 获取文件当前持有的锁信息（诊断用） */
  getLockInfo(filePath: string): LockEntry[] {
    const existing = this._locks.get(filePath);
    if (!existing) return [];
    return Array.isArray(existing) ? [...existing] : [existing];
  }

  /** 获取所有活跃锁的快照（诊断用） */
  snapshot(): ReadonlyMap<string, LockEntry[]> {
    const result = new Map<string, LockEntry[]>();
    for (const [path, entry] of this._locks) {
      result.set(path, Array.isArray(entry) ? [...entry] : [entry]);
    }
    return result;
  }

  /** 清理所有锁（主要用于测试 teardown） */
  clear(): void {
    this._locks.clear();
  }

  /** 活跃锁数量 */
  get size(): number {
    return this._locks.size;
  }

  // ── 私有 ──────────────────────────────────────

  /** 回收超时锁 */
  private _reclaimStale(filePath: string): void {
    const now = Date.now();
    const existing = this._locks.get(filePath);
    if (!existing) return;

    const entries = Array.isArray(existing) ? existing : [existing];
    const stale: LockEntry[] = [];
    const alive: LockEntry[] = [];

    for (const e of entries) {
      if (now - e.acquiredAt > this._config.lockTimeoutMs) {
        stale.push(e);
      } else {
        alive.push(e);
      }
    }

    if (stale.length > 0) {
      for (const s of stale) {
        this._config.onStaleLockReclaimed(s);
      }

      if (alive.length === 0) {
        this._locks.delete(filePath);
      } else if (alive.length === 1) {
        this._locks.set(filePath, alive[0]);
      } else {
        this._locks.set(filePath, alive);
      }
    }
  }
}
