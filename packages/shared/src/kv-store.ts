// ============================================================
// @cortex/shared — 通用键值存储抽象（从 @cortex/memory 迁入）
//
// 定义统一的键值存储接口，作为基础设施层的底层存储抽象。
// 所有具体存储后端（内存、SQLite、Redis 等）均实现此接口。
//
// @why-here 昔涟判例：纯基础设施类型，零包间依赖，归属 shared。
// ============================================================

/**
 * 存储条目，包含值和可选的元数据。
 */
export interface KvStoreEntry<T = unknown> {
  /** 存储的值 */
  value: T;
  /** 创建时间戳（Unix 毫秒） */
  createdAt: number;
  /** 最后更新时间戳（Unix 毫秒） */
  updatedAt: number;
  /** 可选的 TTL（相对毫秒），到期后 get/keys 应跳过 */
  ttlMs?: number;
}

/**
 * KvStore —— 通用键值存储接口。
 *
 * 提供 set/get/delete/clear 等基础操作，支持 TTL 过期、
 * 原子写入、批量操作和迭代访问。
 *
 * @typeParam T - 存储值的类型，默认为 unknown
 */
export interface KvStore<T = unknown> {
  // ── 基础操作 ──

  /**
   * 写入一条记录。
   * 若 key 已存在则覆盖，并更新 updatedAt 时间戳。
   *
   * @param key - 存储键
   * @param value - 存储值
   * @param ttlMs - 可选 TTL（相对毫秒），到期后自动过期
   * @returns 写入的条目快照
   */
  set(key: string, value: T, ttlMs?: number): KvStoreEntry<T>;

  /**
   * 读取一条记录。
   * 若 key 不存在或已过期，返回 undefined。
   *
   * @param key - 存储键
   * @returns 存储条目，或 undefined
   */
  get(key: string): KvStoreEntry<T> | undefined;

  /**
   * 删除一条记录。
   *
   * @param key - 存储键
   * @returns 是否实际删除了条目（key 不存在时返回 false）
   */
  delete(key: string): boolean;

  /**
   * 清空所有记录。
   */
  clear(): void;

  // ── 存在性检查 ──

  /**
   * 检查 key 是否存在且未过期。
   *
   * @param key - 存储键
   * @returns 是否存在有效条目
   */
  has(key: string): boolean;

  // ── 批量操作 ──

  /**
   * 批量写入多条记录。
   *
   * @param entries - 键值对映射
   */
  setMany(entries: Record<string, T>): void;

  /**
   * 批量读取多条记录。
   *
   * @param keys - 键列表
   * @returns 键到条目的映射，不存在的键不会出现在结果中
   */
  getMany(keys: string[]): Record<string, KvStoreEntry<T>>;

  /**
   * 批量删除多条记录。
   *
   * @param keys - 键列表
   * @returns 实际被删除的键数量
   */
  deleteMany(keys: string[]): number;

  // ── 迭代与统计 ──

  /**
   * 返回所有有效（未过期）的键。
   */
  keys(): string[];

  /**
   * 返回所有有效（未过期）的条目。
   */
  entries(): KvStoreEntry<T>[];

  /**
   * 当前有效条目的数量（不含过期条目）。
   */
  readonly size: number;

  // ── 维护 ──

  /**
   * 清理所有已过期的条目。
   * 由具体实现自动调用，也可手动触发。
   *
   * @returns 被清理的条目数量
   */
  purge(): number;
}

// ============================================================
// InMemoryKvStore —— 纯内存实现
// ============================================================

/**
 * InMemoryKvStore —— 基于 Map 的纯内存 KvStore 实现。
 *
 * 特性：
 * - 所有数据驻留在 Map<string, KvStoreEntry> 中
 * - 支持 TTL 过期惰性清理（读取/迭代时自动跳过过期条目）
 * - 支持批量读写删除
 * - purge() 主动清理所有过期条目
 *
 * 线程安全说明：Node.js 单线程模型下 Map 操作是安全的。
 * 若将来需要多进程共享，应切换为 Redis/Memcached 后端。
 *
 * @typeParam T - 存储值的类型，默认为 unknown
 */
export class InMemoryKvStore<T = unknown> implements KvStore<T> {
  /** 底层 Map 存储 */
  private readonly _store: Map<string, KvStoreEntry<T>> = new Map();

  /** 防抖：两次全量过期清理的最小间隔（毫秒），避免 size/keys/entries 高频调用触发 O(n) 扫描 */
  private static readonly PURGE_INTERVAL_MS = 30_000;
  private _lastPurge = 0;

  // ── 基础操作 ─────────────────────────────────

  set(key: string, value: T, ttlMs?: number): KvStoreEntry<T> {
    const now = Date.now();
    const existing = this._store.get(key);

    const entry: KvStoreEntry<T> = {
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ttlMs,
    };

    this._store.set(key, entry);
    return entry;
  }

  get(key: string): KvStoreEntry<T> | undefined {
    const entry = this._store.get(key);
    if (!entry) return undefined;

    // 检查 TTL 过期
    if (this._isExpired(entry)) {
      this._store.delete(key);
      return undefined;
    }

    return entry;
  }

  delete(key: string): boolean {
    return this._store.delete(key);
  }

  clear(): void {
    this._store.clear();
  }

  // ── 存在性检查 ─────────────────────────────

  has(key: string): boolean {
    const entry = this._store.get(key);
    if (!entry) return false;

    if (this._isExpired(entry)) {
      this._store.delete(key);
      return false;
    }

    return true;
  }

  // ── 批量操作 ───────────────────────────────

  setMany(entries: Record<string, T>): void {
    const now = Date.now();
    for (const [key, value] of Object.entries(entries)) {
      const existing = this._store.get(key);
      this._store.set(key, {
        value,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }
  }

  getMany(keys: string[]): Record<string, KvStoreEntry<T>> {
    const result: Record<string, KvStoreEntry<T>> = {};
    for (const key of keys) {
      const entry = this.get(key);
      if (entry !== undefined) {
        result[key] = entry;
      }
    }
    return result;
  }

  deleteMany(keys: string[]): number {
    let count = 0;
    for (const key of keys) {
      if (this._store.delete(key)) {
        count++;
      }
    }
    return count;
  }

  // ── 迭代与统计 ─────────────────────────────

  keys(): string[] {
    this._purgeExpired();
    return Array.from(this._store.keys());
  }

  entries(): KvStoreEntry<T>[] {
    this._purgeExpired();
    return Array.from(this._store.values());
  }

  get size(): number {
    this._purgeExpired();
    return this._store.size;
  }

  // ── 维护 ───────────────────────────────────

  purge(): number {
    return this._purgeExpired();
  }

  // ── 内部辅助 ───────────────────────────────

  /**
   * 判断条目是否已过期。
   */
  private _isExpired(entry: KvStoreEntry<T>): boolean {
    if (entry.ttlMs === undefined || entry.ttlMs <= 0) return false;
    return Date.now() - entry.updatedAt > entry.ttlMs;
  }

  /**
   * 遍历并移除所有过期条目。
   * 内置防抖：若距上次清理不足 PURGE_INTERVAL_MS，跳过以保护高频调用路径。
   *
   * @returns 被移除的条目数量
   */
  private _purgeExpired(): number {
    const now = Date.now();
    if (now - this._lastPurge < InMemoryKvStore.PURGE_INTERVAL_MS) return 0;
    this._lastPurge = now;
    let count = 0;

    for (const [key, entry] of this._store) {
      if (entry.ttlMs !== undefined && entry.ttlMs > 0) {
        if (now - entry.updatedAt > entry.ttlMs) {
          this._store.delete(key);
          count++;
        }
      }
    }

    return count;
  }
}
