/**
 * search-aggregator.ts —— 多源搜索聚合器
 *
 * 职责:
 * 1. 并行查询所有启用的搜索后端
 * 2. 按 URL 去重 (标准化后比较)
 * 3. 交叉排名 (interleaving) 保证结果多样性
 * 4. 内存缓存 (按 query 归一化, TTL 可配置)
 *
 * @layer platform —— 被 Toolkit 使用
 */

import type { SearchBackend, SearchResult } from "./search-backend.js";

// ─── 缓存 ──────────────────────────────────────────

interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
}

// ─── SearchAggregator ──────────────────────────────

export class SearchAggregator {
  private backends: SearchBackend[];
  private cache = new Map<string, CacheEntry>();
  private cacheTTL: number;
  private resultTimeout: number;
  private minBackends: number;

  constructor(opts: {
    backends: SearchBackend[];
    cacheTTL?: number;
    resultTimeout?: number;
    minBackends?: number;
  }) {
    this.backends = opts.backends;
    this.cacheTTL = opts.cacheTTL ?? 300_000;
    this.resultTimeout = opts.resultTimeout ?? 15_000;
    this.minBackends = opts.minBackends ?? 1;
  }

  /** 添加后端 (运行时热插拔) */
  addBackend(backend: SearchBackend): void {
    this.backends.push(backend);
  }

  /** 执行搜索 */
  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    const normQuery = query.trim().toLowerCase();

    // ── 缓存检查 ──
    const cached = this.cache.get(normQuery);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
      return cached.results.slice(0, maxResults);
    }

    // 清理过期缓存
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.cacheTTL) this.cache.delete(key);
    }

    const enabled = this.backends.filter((b) => b.enabled);
    if (enabled.length === 0) return [];

    // ── 并行查询所有已启用后端 ──
    const searches = enabled.map(async (backend) => {
      try {
        const results = await Promise.race([
          backend.search(query, maxResults),
          new Promise<SearchResult[]>((_, reject) =>
            setTimeout(() => reject(new Error(`backend "${backend.id}" timed out`)), this.resultTimeout),
          ),
        ]);
        return results;
      } catch {
        return [] as SearchResult[];
      }
    });

    const allResults = (await Promise.all(searches))
      .filter((r) => r.length > 0);

    // 至少需要 minBackends 个后端成功
    if (allResults.length < this.minBackends) return [];

    // ── 去重 + 交叉排名 ──
    const merged = this._deduplicateAndInterleave(allResults, maxResults);

    // 写入缓存
    if (merged.length > 0) {
      this.cache.set(normQuery, { results: merged, timestamp: Date.now() });
    }

    return merged;
  }

  // ─── 去重 + 交叉排名 ──────────────────────────────

  /**
   * 按 URL 去重 + 交叉交织排名。
   *
   * 去重策略: 标准化 URL (去 trailing slash, lowercase host+path) 后比较。
   *   同一 URL 命中多个后端时，保留 snippet 最长的版本，且加权前置。
   *
   * 排名策略: round-robin interleaving。
   *   各后端取第 1 条 → 各后端取第 2 条 → ...
   *   保证结果多样性，防止单一后端垄断 top N。
   */
  private _deduplicateAndInterleave(
    backendResults: SearchResult[][],
    maxResults: number,
  ): SearchResult[] {
    // 1. 去重: URL → 最佳 snippet
    const seen = new Map<string, SearchResult>();
    for (const results of backendResults) {
      for (const item of results) {
        const key = normalizeUrl(item.url);
        const existing = seen.get(key);
        if (!existing || item.snippet.length > existing.snippet.length) {
          // 同 URL 多后端命中时标记
          const boosted = existing ? { ...item, snippet: `[${item.source}+${existing.source}] ${item.snippet}` } : item;
          seen.set(key, boosted);
        }
      }
    }

    // 2. 恢复原始顺序 + 按来源分组
    const deduped: SearchResult[] = [];
    const sourceBuckets = new Map<string, SearchResult[]>();
    for (const [_urlKey, item] of seen) {
      const source = item.source;
      if (!sourceBuckets.has(source)) sourceBuckets.set(source, []);
      const bucket = sourceBuckets.get(source);
      if (bucket) bucket.push(item);
    }

    // 3. 交叉交织
    const buckets = [...sourceBuckets.values()];
    let bucketIdx = 0;
    while (deduped.length < maxResults && buckets.length > 0) {
      const bucket = buckets[bucketIdx % buckets.length];
      if (bucket.length > 0) {
        const item = bucket.shift();
        if (item) deduped.push(item);
      }
      bucketIdx++;

      // 安全检查: 所有 bucket 都空了就退出
      if (buckets.every((b) => b.length === 0)) break;
    }

    return deduped.slice(0, maxResults);
  }
}

// ─── 工具函数 ──────────────────────────────────────

/** URL 标准化: 去 trailing slash, lowercase scheme+host+path */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    let normalized = `${u.protocol}//${u.hostname}${u.pathname}`.toLowerCase();
    if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
    return normalized;
  } catch {
    return raw.toLowerCase().replace(/\/$/, "");
  }
}
