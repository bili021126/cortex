/**
 * @cortex/prompt-kit — Prompt 缓存层
 *
 * 缓存已解析的 PromptTemplate，减少重复 I/O 和解析开销。
 * LRU 淘汰策略 + TTL 失效。
 *
 * @see DESIGN.md §3.5 PromptCache
 */
/**
 * PromptCache —— LRU 缓存。
 *
 * 缓存策略：
 * - LRU 淘汰：超出 maxSize 时淘汰最久未访问条目
 * - TTL 失效：超时条目在访问时惰性删除
 * - 文件变动检测：可选的文件监听自动失效（待实现）
 */
export class PromptCache {
    cache = new Map();
    maxSize;
    defaultTtlMs;
    hits = 0;
    misses = 0;
    constructor(maxSize = 100, defaultTtlMs = 300_000) {
        this.maxSize = maxSize;
        this.defaultTtlMs = defaultTtlMs;
    }
    /**
     * 获取缓存条目。
     * 如果条目已过期，自动删除并返回 undefined。
     */
    get(key) {
        const item = this.cache.get(key);
        if (!item) {
            this.misses++;
            return undefined;
        }
        // 检查 TTL
        if (Date.now() - item.loadedAt > item.ttlMs) {
            this.cache.delete(key);
            this.misses++;
            return undefined;
        }
        // 更新访问信息
        item.accessedAt = Date.now();
        item.accessCount++;
        this.hits++;
        // LRU：删除后重新插入（保持 Map 迭代顺序）
        this.cache.delete(key);
        this.cache.set(key, item);
        return item.template;
    }
    /**
     * 设置缓存条目。
     */
    set(key, template, ttlMs) {
        // 如果已存在，先删除
        this.cache.delete(key);
        // 检查是否超出容量
        if (this.cache.size >= this.maxSize) {
            this.evictLru();
        }
        const now = Date.now();
        this.cache.set(key, {
            template,
            loadedAt: now,
            accessedAt: now,
            accessCount: 0,
            ttlMs: ttlMs ?? this.defaultTtlMs,
        });
    }
    /**
     * 检查是否存在（不计入命中率统计）。
     */
    has(key) {
        const item = this.cache.get(key);
        if (!item)
            return false;
        if (Date.now() - item.loadedAt > item.ttlMs) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }
    /**
     * 主动失效指定条目。
     */
    evict(key) {
        this.cache.delete(key);
    }
    /**
     * 按标签批量失效。
     * 遍历所有条目，evict 指定标签的模板。
     */
    evictByTag(tag) {
        let count = 0;
        for (const [key, item] of this.cache.entries()) {
            if (item.template.tags?.includes(tag)) {
                this.cache.delete(key);
                count++;
            }
        }
        return count;
    }
    /**
     * 清空所有缓存。
     */
    clear() {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }
    /**
     * 获取缓存统计信息。
     */
    stats() {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
        };
    }
    /**
     * 淘汰最久未访问的条目（LRU）。
     * 使用 Map 的迭代顺序：第一个 key 就是最早插入的（在 get 时已通过 re-insert 更新顺序）。
     */
    evictLru() {
        const firstKey = this.cache.keys().next();
        if (firstKey.value) {
            this.cache.delete(firstKey.value);
        }
    }
}
//# sourceMappingURL=prompt-cache.js.map