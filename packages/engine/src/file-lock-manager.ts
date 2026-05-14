import { LockType } from "@cortex/shared";

/** 锁超时默认值：30s。Agent 崩溃后锁自动回收，避免文件永久不可写。 */
const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
/** 周期性清理间隔：60s */
const CLEANUP_INTERVAL_MS = 60_000;

interface LockEntry {
  type: LockType;
  holders: Set<string>;
  acquiredAt: number;
}

/**
 * FileLockManager —— 文件级读写锁
 * 写锁排斥所有，读锁共存。L2/L3 确认等待期间不持锁。
 * 内置锁超时回收：Agent 崩溃后 30s 自动释放过期锁。
 *
 * @fix M4 — 构造函数中启动周期性清理定时器，防止无界内存增长。
 */
export class FileLockManager {
  private locks = new Map<string, LockEntry>();
  private readonly timeoutMs: number;
  private _cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
    // M4: 启动周期性清理定时器
    this._cleanupTimer = setInterval(() => {
      this.cleanStaleLocks();
    }, CLEANUP_INTERVAL_MS);
    // 允许 Node.js 在仅剩此定时器时退出进程
    if (this._cleanupTimer && typeof this._cleanupTimer === "object" && "unref" in this._cleanupTimer) {
      this._cleanupTimer.unref();
    }
  }

  /**
   * 尝试获取锁。holderId 通常为 Agent 实例 ID。
   * 返回 true 表示获取成功。
   * 遇到过期锁时自动回收后重新尝试获取。
   */
  acquire(filePath: string, type: LockType, holderId: string): boolean {
    // 先清理该文件上的过期锁
    this._cleanStaleLock(filePath);

    const existing = this.locks.get(filePath);
    if (!existing) {
      this.locks.set(filePath, {
        type,
        holders: new Set([holderId]),
        acquiredAt: Date.now(),
      });
      return true;
    }
    // 写锁排斥一切
    if (existing.type === LockType.Write) return false;
    // 读锁排斥写锁
    if (type === LockType.Write && existing.type === LockType.Read) return false;
    // 读锁共存（同类型），续期以保持活跃
    if (type === LockType.Read && existing.type === LockType.Read) {
      existing.holders.add(holderId);
      existing.acquiredAt = Date.now();
      return true;
    }
    return false;
  }

  /** 释放锁 */
  release(filePath: string, holderId: string): void {
    const existing = this.locks.get(filePath);
    if (!existing) return;
    existing.holders.delete(holderId);
    if (existing.holders.size === 0) {
      this.locks.delete(filePath);
    }
  }

  /** 刷新锁活跃时间（持锁 Agent 心跳，防止被误回收） */
  touch(filePath: string, holderId: string): void {
    const existing = this.locks.get(filePath);
    if (existing?.holders.has(holderId)) {
      existing.acquiredAt = Date.now();
    }
  }

  /** 检查是否被锁（不含过期锁） */
  isLocked(filePath: string): boolean {
    this._cleanStaleLock(filePath);
    return this.locks.has(filePath);
  }

  /** 检查 holder 是否持有某文件的锁 */
  holds(filePath: string, holderId: string): boolean {
    return this.locks.get(filePath)?.holders.has(holderId) ?? false;
  }

  /** 全局清理所有过期锁（由周期性定时器调用） */
  cleanStaleLocks(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [filePath, entry] of this.locks) {
      if (now - entry.acquiredAt > this.timeoutMs) {
        this.locks.delete(filePath);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.warn(`[FileLockManager] 回收 ${cleaned} 个过期锁`);
    }
    return cleaned;
  }

  /** 释放定时器资源 */
  dispose(): void {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this.locks.clear();
  }

  /** 内部：清理特定文件上的过期锁 */
  private _cleanStaleLock(filePath: string): void {
    const entry = this.locks.get(filePath);
    if (entry && Date.now() - entry.acquiredAt > this.timeoutMs) {
      console.warn(
        `[FileLockManager] 锁超时回收: ${filePath}（持有者崩溃？holders: ${[...entry.holders].join(", ")}）`,
      );
      this.locks.delete(filePath);
    }
  }
}
