/**
 * @cortex/cache — 烟雾测试
 * 验证三层缓存导出完整性和基本实例化。
 */
import { describe, it, expect } from "vitest";
import { LlmCache, FileHashCache, MemoryCacheLayer } from "@cortex/cache";
describe("@cortex/cache barrel", () => {
    it("should export LlmCache", () => {
        const cache = new LlmCache({});
        expect(cache).toBeDefined();
    });
    it("should export FileHashCache", () => {
        const fhc = new FileHashCache({});
        expect(fhc).toBeDefined();
    });
    it("should export MemoryCacheLayer", () => {
        const mcl = new MemoryCacheLayer({ ttlMs: 60_000, maxEntries: 100 });
        expect(mcl).toBeDefined();
    });
});
//# sourceMappingURL=smoke.test.js.map