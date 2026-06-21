/**
 * @cortex/prompt-kit — Prompt 缓存层
 *
 * 缓存已解析的 PromptTemplate，减少重复 I/O 和解析开销。
 * LRU 淘汰策略 + TTL 失效。
 *
 * @see DESIGN.md §3.5 PromptCache
 */
import type { PromptTemplate, CacheStats } from "../types.js";
/**
 * PromptCache —— LRU 缓存。
 *
 * 缓存策略：
 * - LRU 淘汰：超出 maxSize 时淘汰最久未访问条目
 * - TTL 失效：超时条目在访问时惰性删除
 * - 文件变动检测：可选的文件监听自动失效（待实现）
 */
export declare class PromptCache {
    private cache;
    private maxSize;
    private defaultTtlMs;
    private hits;
    private misses;
    constructor(maxSize?: number, defaultTtlMs?: number);
    /**
     * 获取缓存条目。
     * 如果条目已过期，自动删除并返回 undefined。
     */
    get(key: string): PromptTemplate | undefined;
    /**
     * 设置缓存条目。
     */
    set(key: string, template: PromptTemplate, ttlMs?: number): void;
    /**
     * 检查是否存在（不计入命中率统计）。
     */
    has(key: string): boolean;
    /**
     * 主动失效指定条目。
     */
    evict(key: string): void;
    /**
     * 按标签批量失效。
     * 遍历所有条目，evict 指定标签的模板。
     */
    evictByTag(tag: string): number;
    /**
     * 清空所有缓存。
     */
    clear(): void;
    /**
     * 获取缓存统计信息。
     */
    stats(): CacheStats;
    /**
     * 淘汰最久未访问的条目（LRU）。
     * 使用 Map 的迭代顺序：第一个 key 就是最早插入的（在 get 时已通过 re-insert 更新顺序）。
     */
    private evictLru;
}
//# sourceMappingURL=prompt-cache.d.ts.map