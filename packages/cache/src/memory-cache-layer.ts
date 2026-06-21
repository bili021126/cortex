// ============================================================
// @cortex/cache —— 记忆缓存层
//
// @file-overview
// 轻量级记忆加速层，作为 MemoryStore 的 disposable 缓存前置。
// 不替代 ground truth，仅提供线索提示加速记忆检索。
//
// @design
// - 写入强一致：只有来自 MemoryStore（ground truth）的数据才能写入
//   写入时必须传入 verified=true + 来源 memoryId
// - 读取最终一致：读取不保证最新，返回 { value, stale } 标记
//   消费方（Agent）必须对 stale=true 的结果进行 ground truth 验证
// - TTL 天/周级：默认 7 天过期
// - 可丢弃：clear() 不影响正确性，仅影响性能
//
// @contract
// - write(entry, verified, memoryId): Promise<void>
// - read(semanticGist): Promise<{ entry, stale } | null>
// - reconcile(memoryStore): Promise<void>  ← 与 ground truth 对账
// ============================================================

import * as crypto from "node:crypto";
import type { MemoryCacheEntry, MemoryCacheConfig, CacheStats } from "./types.js";

/** 默认配置 */
const DEFAULTS: Required<MemoryCacheConfig> = {
  maxEntries: 1000,
  ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 天
  autoVerify: false,
};

export class MemoryCacheLayer {
  private _entries = new Map<string, MemoryCacheEntry>();
  private _config: Required<MemoryCacheConfig>;
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;
  private _staleHits = 0; // 返回了 stale 数据的次数

  constructor(config?: MemoryCacheConfig) {
    this._config = { ...DEFAULTS, ...config };
  }

  // ── 公开 API ──

  /**
   * 写入缓存条目。
   * 强一致约束：必须 verified=true。
   *
   * @param entry 记忆缓存条目
   * @param verified 是否经过 ground truth 验证（未验证时抛出）
   * @param _sourceMemoryId 来源记忆 ID（保留，供未来审计）
   */
  async write(
    entry: MemoryCacheEntry,
    verified: boolean,
    _sourceMemoryId?: string,
  ): Promise<void> {
    if (!verified) {
      throw new Error(
        "[MemoryCacheLayer] 写入拒绝：未通过 ground truth 验证。记忆缓存仅接受已验证数据。",
      );
    }

    // 去重：同一 semanticGist 的条目覆盖（保留最新）
    const existing = this._findByGist(entry.semanticGist);
    if (existing) {
      this._entries.delete(existing);
    }

    // LRU 驱逐
    if (this._entries.size >= this._config.maxEntries) {
      this._evictOldest();
    }

    entry.createdAt = Date.now();
    entry.lastVerifiedAt = Date.now();
    entry.verifyCount = (entry.verifyCount ?? 0) + 1;

    const key = this._buildKey(entry);
    this._entries.set(key, entry);
  }

  /**
   * 读取缓存条目。
   * 返回 stale 标记：消费方应对 stale=true 的结果做 ground truth 验证。
   *
   * @param semanticGist 语义要点（模糊匹配线索）
   * @returns 匹配的条目 + stale 标记，或 null
   */
  async read(semanticGist: string): Promise<{
    entry: MemoryCacheEntry;
    stale: boolean;
  } | null> {
    const key = this._findByGist(semanticGist);
    if (!key) {
      this._misses++;
      return null;
    }

    const entry = this._entries.get(key);
    if (!entry) return null;
    const now = Date.now();
    const isExpired = now - entry.createdAt > this._config.ttlMs;
    const needsVerification =
      isExpired || now - entry.lastVerifiedAt > this._config.ttlMs / 2;

    entry.lastAccessedAt = now;

    if (isExpired) {
      // 过期但保留：返回 stale 标记，让消费方自行判断
      this._staleHits++;
      this._hits++;
      return { entry, stale: true };
    }

    this._hits++;
    return { entry, stale: needsVerification };
  }

  /**
   * 与 ground truth（MemoryStore）对账。
   * 清除已过期或不在 MemoryStore 中的条目。
   *
   * @param validMemoryIds MemoryStore 中当前有效的记忆 ID 集合
   */
  async reconcile(validMemoryIds: Set<string>): Promise<number> {
    let removed = 0;

    for (const [key, entry] of this._entries) {
      // 1. 清除不在 ground truth 中的条目
      if (!validMemoryIds.has(entry.id)) {
        this._entries.delete(key);
        removed++;
        continue;
      }

      // 2. 刷新已验证时间
      entry.lastVerifiedAt = Date.now();
    }

    return removed;
  }

  /** 标记某条记忆已验证 */
  markVerified(id: string): boolean {
    for (const entry of this._entries.values()) {
      if (entry.id === id) {
        entry.lastVerifiedAt = Date.now();
        entry.verifyCount++;
        return true;
      }
    }
    return false;
  }

  /** 缓存统计 */
  get stats(): CacheStats {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      rate: total === 0 ? "0%" : `${((this._hits / total) * 100).toFixed(1)}%`,
      size: this._entries.size,
      capacity: this._config.maxEntries,
      evictions: this._evictions,
      expiredEvictions: this._staleHits,
    };
  }

  /** 清空缓存（不影响正确性） */
  clear(): void {
    this._entries.clear();
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
    this._staleHits = 0;
  }

  /** 当前条目数 */
  get size(): number {
    return this._entries.size;
  }

  /** 获取所有条目（调试用） */
  get entries(): ReadonlyMap<string, Readonly<MemoryCacheEntry>> {
    return this._entries;
  }

  // ── 内部方法 ──

  /** 构建条目键 */
  private _buildKey(entry: MemoryCacheEntry): string {
    return crypto
      .createHash("sha256")
      .update(`${entry.id}:${entry.semanticGist}`)
      .digest("hex");
  }

  /** 根据语义要点查找匹配条目（子串匹配） */
  private _findByGist(gist: string): string | null {
    const lower = gist.toLowerCase();
    for (const [key, entry] of this._entries) {
      if (entry.semanticGist.toLowerCase().includes(lower) || lower.includes(entry.semanticGist.toLowerCase())) {
        return key;
      }
    }
    return null;
  }

  /** 驱逐最旧条目 */
  private _evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [key, entry] of this._entries) {
      if (entry.createdAt < oldestTs) {
        oldestTs = entry.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this._entries.delete(oldestKey);
      this._evictions++;
    }
  }
}

// 类型扩展（用于内部访问）
declare module "./types.js" {
  interface MemoryCacheEntry {
    lastAccessedAt?: number;
  }
}
