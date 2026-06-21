// @ci: unit
/**
 * @cortex/prompt-kit — PromptCache 单元测试
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PromptCache } from "../../src/cache/prompt-cache.js";
function makeTemplate(id, tags = []) {
    return {
        id,
        name: id,
        version: "1.0.0",
        blocks: [],
        tags,
        source: "test",
    };
}
describe("PromptCache", () => {
    let cache;
    beforeEach(() => {
        cache = new PromptCache(3, 5000); // maxSize=3, TTL=5s
    });
    describe("基础操作", () => {
        it("set 后应能 get", () => {
            const tpl = makeTemplate("test-template");
            cache.set("test", tpl);
            const result = cache.get("test");
            expect(result).toBeDefined();
            expect(result.id).toBe("test-template");
        });
        it("不存在的 key 应返回 undefined", () => {
            const result = cache.get("nonexistent");
            expect(result).toBeUndefined();
        });
        it("has 应正确检测存在性", () => {
            cache.set("key1", makeTemplate("t1"));
            expect(cache.has("key1")).toBe(true);
            expect(cache.has("key2")).toBe(false);
        });
    });
    describe("LRU 淘汰策略", () => {
        it("超出 maxSize 应淘汰最久未访问的条目", () => {
            cache.set("a", makeTemplate("a"));
            cache.set("b", makeTemplate("b"));
            cache.set("c", makeTemplate("c"));
            // 访问 a 和 b，使其成为最近使用
            cache.get("a");
            cache.get("b");
            // 插入 d，应淘汰 c（最久未访问）
            cache.set("d", makeTemplate("d"));
            expect(cache.get("a")).toBeDefined();
            expect(cache.get("b")).toBeDefined();
            expect(cache.get("d")).toBeDefined();
            expect(cache.get("c")).toBeUndefined();
        });
        it("多次访问应更新 LRU 顺序", () => {
            cache.set("a", makeTemplate("a"));
            cache.set("b", makeTemplate("b"));
            cache.set("c", makeTemplate("c"));
            cache.get("a");
            cache.get("c");
            cache.get("b");
            cache.set("d", makeTemplate("d"));
            const stats = cache.stats();
            expect(stats.size).toBeLessThanOrEqual(3);
        });
    });
    describe("TTL 失效", () => {
        it("过期条目应自动失效", async () => {
            const shortCache = new PromptCache(10, 50);
            shortCache.set("expire", makeTemplate("expire"));
            expect(shortCache.get("expire")).toBeDefined();
            await new Promise((r) => setTimeout(r, 60));
            expect(shortCache.get("expire")).toBeUndefined();
        });
        it("自定义 TTL 应覆盖默认 TTL", async () => {
            const shortCache = new PromptCache(10, 5000);
            shortCache.set("custom", makeTemplate("custom"), 30);
            expect(shortCache.get("custom")).toBeDefined();
            await new Promise((r) => setTimeout(r, 40));
            expect(shortCache.get("custom")).toBeUndefined();
        });
    });
    describe("主动失效", () => {
        it("evict 应移除指定条目", () => {
            cache.set("a", makeTemplate("a"));
            cache.set("b", makeTemplate("b"));
            cache.evict("a");
            expect(cache.get("a")).toBeUndefined();
            expect(cache.get("b")).toBeDefined();
        });
        it("evictByTag 应按标签移除条目", () => {
            cache.set("t1", makeTemplate("t1", ["tag1"]));
            cache.set("t2", makeTemplate("t2", ["tag1", "tag2"]));
            cache.set("t3", makeTemplate("t3", ["tag2"]));
            const removed = cache.evictByTag("tag1");
            expect(removed).toBe(2);
            expect(cache.get("t1")).toBeUndefined();
            expect(cache.get("t2")).toBeUndefined();
            expect(cache.get("t3")).toBeDefined();
        });
        it("clear 应清空所有条目并重置统计", () => {
            cache.set("a", makeTemplate("a"));
            cache.set("b", makeTemplate("b"));
            // 检查统计后再清空
            const statsBefore = cache.stats();
            expect(statsBefore.size).toBe(2);
            cache.clear();
            const stats = cache.stats();
            expect(stats.size).toBe(0);
            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(0);
            // 清空后获取应继续计数
            cache.get("a");
            cache.get("b");
            const statsAfter = cache.stats();
            expect(statsAfter.misses).toBe(2);
        });
    });
    describe("统计信息", () => {
        it("stats 应返回正确的缓存统计", () => {
            const stats = cache.stats();
            expect(stats.size).toBe(0);
            expect(stats.maxSize).toBe(3);
            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(0);
            expect(stats.hitRate).toBe(0);
        });
        it("统计应正确记录命中与未命中", () => {
            cache.set("key", makeTemplate("key"));
            cache.get("key"); // hit
            cache.get("key"); // hit
            cache.get("missing"); // miss
            const stats = cache.stats();
            expect(stats.hits).toBe(2);
            expect(stats.misses).toBe(1);
            expect(stats.hitRate).toBeCloseTo(2 / 3, 5);
        });
    });
});
//# sourceMappingURL=cache.test.js.map