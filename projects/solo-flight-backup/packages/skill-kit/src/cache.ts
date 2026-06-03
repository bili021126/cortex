// ============================================================================
// @cortex/skill-kit — Cache
//
// Three-tier cache: SkillDefinition, ValidationResult, rendered templates.
// Supports LRU, FIFO, and TTL strategies.
// ============================================================================

import type { SkillDefinition, ValidationResult, CacheOptions, CacheStrategy, CacheStats } from './types.js';

// ─── Internal Types ────────────────────────────────────────────────────────

interface CacheEntryMeta {
  /** 缓存时间戳 */
  cachedAt: number;

  /** 文件修改时间（用于文件来源的缓存失效） */
  mtimeMs?: number;

  /** 访问次数 */
  hitCount: number;

  /** 最后访问时间 */
  lastAccessed: number;
}

interface CacheEntry<T> {
  value: T;
  meta: CacheEntryMeta;
}

/**
 * Cache —— 技能编译/解析结果缓存。
 *
 * 职责：
 * 1. 缓存已加载的 SkillDefinition（避免重复加载）
 * 2. 缓存校验结果（避免重复校验）
 * 3. 缓存模板渲染结果（避免重复渲染）
 * 4. LRU 淘汰 + TTL 过期
 */
export class Cache {
  private readonly defs: Map<string, CacheEntry<SkillDefinition>> = new Map();
  private readonly validations: Map<string, CacheEntry<ValidationResult>> = new Map();
  private readonly renders: Map<string, CacheEntry<string>> = new Map();
  private readonly options: Required<CacheOptions>;

  constructor(options: CacheOptions = {}) {
    this.options = {
      maxSize: 100,
      strategy: 'lru',
      ttlMs: 5 * 60 * 1000,
      ...options,
    };
  }

  // ─── SkillDefinition 缓存 ──────────────────────

  /** 根据技能 ID 获取缓存的 SkillDefinition */
  getDefinition(skillId: string): SkillDefinition | undefined {
    return this.get(this.defs, skillId)?.value;
  }

  /** 缓存 SkillDefinition */
  setDefinition(skill: SkillDefinition): void {
    this.set(this.defs, skill.id, skill);
  }

  /** 从缓存中移除技能 */
  evictDefinition(skillId: string): void {
    this.defs.delete(skillId);
  }

  /** 检查技能是否在缓存中 */
  hasDefinition(skillId: string): boolean {
    return this.defs.has(skillId);
  }

  // ─── Validation 缓存 ───────────────────────────

  /** 获取缓存的校验结果 */
  getValidation(skillId: string): ValidationResult | undefined {
    return this.get(this.validations, skillId)?.value;
  }

  /** 缓存校验结果 */
  setValidation(skillId: string, result: ValidationResult): void {
    this.set(this.validations, skillId, result);
  }

  // ─── Template Render 缓存 ──────────────────────

  /** 获取缓存的渲染结果 */
  getRender(cacheKey: string): string | undefined {
    return this.get(this.renders, cacheKey)?.value;
  }

  /** 缓存渲染结果 */
  setRender(cacheKey: string, rendered: string): void {
    this.set(this.renders, cacheKey, rendered);
  }

  // ─── 缓存管理 ───────────────────────────────────

  /** 清空所有缓存 */
  clear(): void {
    this.defs.clear();
    this.validations.clear();
    this.renders.clear();
  }

  /** 当前缓存统计 */
  stats(): CacheStats {
    return {
      definitions: this.defs.size,
      validations: this.validations.size,
      renders: this.renders.size,
      maxSize: this.options.maxSize,
    };
  }

  // ─── 内部方法 ───────────────────────────────────

  private get<T>(
    map: Map<string, CacheEntry<T>>,
    key: string,
  ): CacheEntry<T> | undefined {
    const entry = map.get(key);
    if (!entry) return undefined;

    // TTL 检查
    if (this.options.strategy === 'ttl') {
      const age = Date.now() - entry.meta.cachedAt;
      if (age > this.options.ttlMs) {
        map.delete(key);
        return undefined;
      }
    }

    entry.meta.hitCount++;
    entry.meta.lastAccessed = Date.now();
    return entry;
  }

  private set<T>(
    map: Map<string, CacheEntry<T>>,
    key: string,
    value: T,
  ): void {
    // 淘汰检查
    if (map.size >= this.options.maxSize) {
      this.evictOne(map);
    }

    map.set(key, {
      value,
      meta: {
        cachedAt: Date.now(),
        hitCount: 0,
        lastAccessed: Date.now(),
      },
    });
  }

  private evictOne<T>(map: Map<string, CacheEntry<T>>): void {
    const strategy = this.options.strategy;

    if (strategy === 'fifo') {
      // FIFO: 淘汰最早缓存的条目
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [key, entry] of map) {
        if (entry.meta.cachedAt < oldestTime) {
          oldestTime = entry.meta.cachedAt;
          oldestKey = key;
        }
      }
      if (oldestKey) map.delete(oldestKey);
      return;
    }

    // LRU (default): 淘汰最久未访问的条目
    let lruKey: string | undefined;
    let lruTime = Infinity;
    for (const [key, entry] of map) {
      if (entry.meta.lastAccessed < lruTime) {
        lruTime = entry.meta.lastAccessed;
        lruKey = key;
      }
    }
    if (lruKey) map.delete(lruKey);
  }
}
