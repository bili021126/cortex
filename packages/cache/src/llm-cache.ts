// ============================================================
// @cortex/cache —— LLM 响应缓存
//
// @file-overview
// 从 @cortex/llm LlmAdapter 中提取的独立缓存层。
// 通用 LLM 请求/响应缓存，支持 SHA256 键控和文件哈希失效。
//
// @design
// - 两层缓存键：
//   a) exact 模式：SHA256(model + messages + tools) —— 请求内容完全相同时命中
//   b) fingerprint 模式：额外注入 fileHashes，文件变更即失效
// - LRU 驱逐 + TTL 过期
// - 可序列化/反序列化，支持跨进程持久化
//
// @contract
// - get(params, fileHashes?): LlmCacheValue | null
// - set(params, value, fileHashes?): void
// - 异步方法返回 Promise，但内部 Map 操作同步
// ============================================================

import * as crypto from "node:crypto";
import type { LlmCacheConfig, LlmCacheKeyParams, LlmCacheValue, CacheStats } from "./types.js";

/** 内部条目 */
interface InternalEntry {
  value: LlmCacheValue;
  ts: number;
  expiresAt: number;
}

/** 默认配置 */
const DEFAULTS: Required<Omit<LlmCacheConfig, "fileHashes">> = {
  maxEntries: 500,
  ttlMs: 10 * 60 * 1000, // 10 分钟
  mode: "exact",
};

export class LlmCache {
  private _cache = new Map<string, InternalEntry>();
  private _config: Required<Omit<LlmCacheConfig, "fileHashes">>;
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;
  private _expiredEvictions = 0;
  private _fileHashes: Map<string, string> | null = null;

  constructor(config?: LlmCacheConfig) {
    this._config = { ...DEFAULTS, ...config };
    if (config?.fileHashes) {
      this._fileHashes = new Map(config.fileHashes);
    }
  }

  // ── 公开 API ──

  /**
   * 查询缓存。
   * @param params LLM 请求参数
   * @param fileHashes 本次请求的依赖文件哈希（fingerprint 模式）
   * @returns 缓存值，或 null 表示未命中/已过期
   */
  get(params: LlmCacheKeyParams, fileHashes?: Map<string, string>): LlmCacheValue | null {
    const key = this._buildKey(params, fileHashes);
    const entry = this._cache.get(key);

    if (!entry) {
      this._misses++;
      return null;
    }

    // TTL 检查
    if (Date.now() > entry.expiresAt) {
      this._cache.delete(key);
      this._misses++;
      this._expiredEvictions++;
      return null;
    }

    this._hits++;
    return entry.value;
  }

  /**
   * 写入缓存。
   * @param params LLM 请求参数
   * @param value LLM 响应值
   * @param fileHashes 本次请求的依赖文件哈希（fingerprint 模式）
   */
  set(params: LlmCacheKeyParams, value: LlmCacheValue, fileHashes?: Map<string, string>): void {
    const key = this._buildKey(params, fileHashes);

    // LRU 驱逐
    if (this._cache.size >= this._config.maxEntries) {
      const oldest = this._findOldestEntry();
      if (oldest) {
        this._cache.delete(oldest);
        this._evictions++;
      }
    }

    const now = Date.now();
    this._cache.set(key, {
      value,
      ts: now,
      expiresAt: now + this._config.ttlMs,
    });
  }

  /** 更新文件哈希集合（fingerprint 模式） */
  setFileHashes(hashes: Map<string, string>): void {
    // 检查旧哈希是否变更——若变更，清除所有使用该哈希的缓存项
    if (this._fileHashes) {
      for (const [file, newHash] of hashes) {
        const oldHash = this._fileHashes.get(file);
        if (oldHash !== undefined && oldHash !== newHash) {
          this._invalidateByFileHash(oldHash);
        }
      }
    }
    this._fileHashes = new Map(hashes);
  }

  /** 根据文件哈希失效所有匹配的缓存项 */
  private _invalidateByFileHash(hash: string): void {
    for (const [key] of this._cache) {
      if (key.includes(hash)) {
        this._cache.delete(key);
        this._evictions++;
      }
    }
  }

  /** 缓存统计 */
  get stats(): CacheStats {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      rate: total === 0 ? "0%" : `${((this._hits / total) * 100).toFixed(1)}%`,
      size: this._cache.size,
      capacity: this._config.maxEntries,
      evictions: this._evictions,
      expiredEvictions: this._expiredEvictions,
    };
  }

  /** 清空缓存 */
  clear(): void {
    this._cache.clear();
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
    this._expiredEvictions = 0;
  }

  /** 序列化到 JSON（持久化） */
  serialize(): string {
    const obj: Record<string, InternalEntry> = {};
    for (const [k, v] of this._cache) obj[k] = v;
    return JSON.stringify(obj);
  }

  /** 从 JSON 恢复 */
  deserialize(json: string): void {
    try {
      const obj = JSON.parse(json) as Record<string, InternalEntry>;
      for (const [k, v] of Object.entries(obj)) {
        if (this._cache.size >= this._config.maxEntries) break;
        // 跳过已过期的条目
        if (Date.now() > v.expiresAt) {
          this._expiredEvictions++;
          continue;
        }
        this._cache.set(k, v);
      }
    } catch {
      // 缓存文件损坏，静默失败
    }
  }

  /** 当前条目数 */
  get size(): number {
    return this._cache.size;
  }

  /** 获取文件哈希快照 */
  get fileHashes(): ReadonlyMap<string, string> | null {
    return this._fileHashes;
  }

  // ── 内部方法 ──

  /**
   * 构建缓存键。
   * exact 模式：SHA256(model + messages + tools)
   * fingerprint 模式：额外拼接 fileHashes
   */
  private _buildKey(params: LlmCacheKeyParams, fileHashes?: Map<string, string>): string {
    const effectiveHashes = fileHashes ?? this._fileHashes;
    const usesFingerprint = this._config.mode === "fingerprint" && effectiveHashes && effectiveHashes.size > 0;

    const hash = crypto.createHash("sha256");
    hash.update(params.model);
    hash.update("|");
    hash.update(params.messagesText);
    hash.update("|");
    hash.update(params.toolsText);

    if (params.reasoningEffort) {
      hash.update("|re:");
      hash.update(params.reasoningEffort);
    }

    // fingerprint 模式：注入文件哈希
    if (usesFingerprint) {
      hash.update("|fh:");
      // 排序保证确定性
      const sorted = [...effectiveHashes.entries()].sort(([a], [b]) => a.localeCompare(b));
      for (const [file, fileHash] of sorted) {
        hash.update(`${file}=${fileHash};`);
      }
    }

    return hash.digest("hex");
  }

  /** 找到最旧的条目（用于 LRU 驱逐） */
  private _findOldestEntry(): string | null {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [key, entry] of this._cache) {
      if (entry.ts < oldestTs) {
        oldestTs = entry.ts;
        oldestKey = key;
      }
    }
    return oldestKey;
  }
}
