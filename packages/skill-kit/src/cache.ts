/**
 * @cortex/skill-kit — LRU 技能缓存
 *
 * 实现 SkillCache 接口，提供 LRU（最近最少使用）淘汰策略 + TTL 过期。
 *
 * 缓存策略：
 * - LRU 淘汰（最近最少使用）
 * - TTL 存活时间过期
 * - 主动失效（evict / clear）
 * - 缓存统计（命中率）
 *
 * @see docs/design.md §6 缓存策略
 */

import {
  type SkillDefinition,
  type SkillCache,
  type CacheStats,
} from "./types.js";

// ============================================================
// 缓存条目
// ============================================================

interface CacheEntry {
  /** 缓存的技能定义 */
  skill: SkillDefinition;
  /** 是否已调用 onInit */
  initialized: boolean;
  /** 加载时间戳 */
  loadedAt: number;
  /** TTL（毫秒），0 表示永不过期 */
  ttlMs: number;
}

// ============================================================
// DefaultSkillCache — LRU + TTL 缓存实现
// ============================================================

export interface DefaultSkillCacheOptions {
  /** 最大缓存条目数，默认 100 */
  maxSize?: number;
  /** 默认 TTL（毫秒），默认 60_000（60 秒） */
  defaultTtlMs?: number;
}

/**
 * DefaultSkillCache —— LRU（最近最少使用）+ TTL 过期缓存。
 *
 * 实现细节：
 * - 使用 Map 维护插入顺序（Map 的迭代顺序即插入顺序）
 * - get() 时删除再重新 set 以更新 LRU 位置
 * - set() 时若超出容量，删除最久未使用的条目（Map 的第一个键）
 * - TTL 过期在 get() 时惰性检查
 */
export class DefaultSkillCache implements SkillCache {
  /** 底层存储（Map 保证插入顺序 = LRU 顺序） */
  private cache: Map<string, CacheEntry> = new Map();

  /** 最大容量 */
  private maxSize: number;

  /** 默认 TTL */
  private defaultTtlMs: number;

  /** 命中次数 */
  private hits: number = 0;

  /** 未命中次数 */
  private misses: number = 0;

  constructor(options: DefaultSkillCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 100;
    this.defaultTtlMs = options.defaultTtlMs ?? 60_000;
  }

  /**
   * 获取缓存的技能定义。
   * 如果缓存未命中或已过期，返回 undefined。
   */
  get(skillId: string): SkillDefinition | undefined {
    const entry = this.cache.get(skillId);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // 检查 TTL 过期
    if (this.isExpired(entry)) {
      this.cache.delete(skillId);
      this.misses++;
      return undefined;
    }

    // LRU 更新：删除再插入（移动到 Map 末尾 = 最近使用）
    this.cache.delete(skillId);
    this.cache.set(skillId, entry);
    this.hits++;

    return entry.skill;
  }

  /**
   * 设置缓存。
   * @param ttlMs 可选——自定义 TTL，不传则使用默认 TTL。
   */
  set(skillId: string, skill: SkillDefinition, ttlMs?: number): void {
    // 如果已存在，先删除（后续重新插到末尾）
    if (this.cache.has(skillId)) {
      this.cache.delete(skillId);
    }

    // 容量检查：超出时删除最久未使用的条目（Map 的第一个键）
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        const oldEntry = this.cache.get(oldestKey);
        // 如果旧条目有 onDestroy，调用销毁钩子
        if (oldEntry && oldEntry.initialized && oldEntry.skill.onDestroy) {
          oldEntry.skill.onDestroy().catch(() => {
            /* 忽略销毁时的错误 */
          });
        }
        this.cache.delete(oldestKey);
      }
    }

    const entry: CacheEntry = {
      skill,
      initialized: false,
      loadedAt: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    };

    this.cache.set(skillId, entry);
  }

  /**
   * 检查技能是否在缓存中（且未过期）。
   */
  has(skillId: string): boolean {
    const entry = this.cache.get(skillId);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.cache.delete(skillId);
      return false;
    }
    return true;
  }

  /**
   * 主动失效指定技能缓存。
   * 如果技能已初始化，调用 skill.onDestroy()。
   */
  evict(skillId: string): void {
    const entry = this.cache.get(skillId);
    if (entry) {
      if (entry.initialized && entry.skill.onDestroy) {
        entry.skill.onDestroy().catch(() => {
          /* 忽略销毁时的错误 */
        });
      }
      this.cache.delete(skillId);
    }
  }

  /**
   * 清空所有缓存。
   * 遍历所有已初始化的技能，调用 onDestroy()。
   */
  clear(): void {
    // 先调用所有已初始化技能的 onDestroy
    for (const [, entry] of this.cache.entries()) {
      if (entry.initialized && entry.skill.onDestroy) {
        entry.skill.onDestroy().catch(() => {
          /* 忽略销毁时的错误 */
        });
      }
    }
    this.cache.clear();
  }

  /**
   * 获取缓存统计信息。
   */
  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  /**
   * 重置统计信息。
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * 标记指定技能为已初始化。
   * 在 SkillFactory 中由 Executor 调用。
   */
  markInitialized(skillId: string): void {
    const entry = this.cache.get(skillId);
    if (entry) {
      entry.initialized = true;
    }
  }

  /**
   * 检查条目是否已过期。
   * ttlMs === 0 表示永不过期。
   */
  private isExpired(entry: CacheEntry): boolean {
    if (entry.ttlMs === 0) return false;
    return Date.now() - entry.loadedAt > entry.ttlMs;
  }
}
