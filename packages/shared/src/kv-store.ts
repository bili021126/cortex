// ============================================================
// @cortex/shared — 通用键值存储抽象（纯类型中枢）
//
// 定义统一的键值存储接口，作为基础设施层的底层存储抽象。
// 所有具体存储后端（内存、SQLite、Redis 等）均实现此接口。
// 运行时实现 InMemoryKvStore 已迁出。
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

  set(key: string, value: T, ttlMs?: number): KvStoreEntry<T>;
  get(key: string): KvStoreEntry<T> | undefined;
  delete(key: string): boolean;
  clear(): void;

  // ── 存在性检查 ──

  has(key: string): boolean;

  // ── 批量操作 ──

  setMany(entries: Record<string, T>): void;
  getMany(keys: string[]): Record<string, KvStoreEntry<T>>;
  deleteMany(keys: string[]): number;

  // ── 迭代与统计 ──

  keys(): string[];
  entries(): KvStoreEntry<T>[];
  readonly size: number;

  // ── 维护 ──

  purge(): number;
}
