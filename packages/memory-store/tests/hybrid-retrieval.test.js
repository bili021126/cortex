import { describe, it, expect } from "vitest";
import { HybridRetriever, DEFAULT_HYBRID_CONFIG } from "../src/hybrid-retrieval.js";
describe("HybridRetriever smoke", () => {
    it("默认配置可创建", () => {
        const hr = new HybridRetriever();
        expect(hr.config.alpha).toBe(0.45);
        expect(hr.config.beta).toBe(0.55);
    });
    it("自定义配置可注入", () => {
        const hr = new HybridRetriever({ alpha: 0.3, beta: 0.7 });
        expect(hr.config.alpha).toBe(0.3);
        expect(hr.config.beta).toBe(0.7);
    });
    it("默认配置常量一致性", () => {
        expect(DEFAULT_HYBRID_CONFIG.alpha).toBe(0.45);
        expect(DEFAULT_HYBRID_CONFIG.beta).toBe(0.55);
        expect(DEFAULT_HYBRID_CONFIG.fineTopN).toBe(15);
    });
    it("空候选列表返回空结果", async () => {
        const hr = new HybridRetriever();
        const result = await hr.score([], new Map(), [], null);
        expect(result).toEqual([]);
    });
    it("greedyFineRank 空数组返回空", () => {
        const hr = new HybridRetriever();
        expect(hr.greedyFineRank([])).toEqual([]);
    });
});
//# sourceMappingURL=hybrid-retrieval.test.js.map