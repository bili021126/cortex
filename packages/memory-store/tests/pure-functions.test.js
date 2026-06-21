// @ci: unit
import { describe, it, expect } from "vitest";
import { tokenize, fourierTimeDecay, cosineSimilarity, batchCosineSimilarity, DEFAULT_HYBRID_CONFIG, DEFAULT_COGNITIVE_CONFIG, } from "@cortex/memory-store";
describe("@cortex/memory-store — tokenize", () => {
    it("英文分词返回小写 token 数组", () => {
        const tokens = tokenize("Hello World Memory Store");
        expect(Array.isArray(tokens)).toBe(true);
        expect(tokens).toContain("hello");
        expect(tokens).toContain("world");
    });
    it("空字符串返回空数组", () => {
        expect(tokenize("")).toEqual([]);
    });
});
describe("@cortex/memory-store — fourierTimeDecay", () => {
    it("给定时间戳返回数值", () => {
        const val = fourierTimeDecay(1000, DEFAULT_COGNITIVE_CONFIG);
        expect(typeof val).toBe("number");
        expect(val).toBeGreaterThanOrEqual(0);
    });
    it("更近时间衰减更小（权重更高）", () => {
        const recent = fourierTimeDecay(0, DEFAULT_COGNITIVE_CONFIG);
        const older = fourierTimeDecay(86400000, DEFAULT_COGNITIVE_CONFIG);
        expect(recent).toBeGreaterThanOrEqual(older);
    });
});
describe("@cortex/memory-store — 向量纯函数", () => {
    it("cosineSimilarity 归一化相同向量点积为正", () => {
        const v = [0.6, 0.8]; // 已归一化 (|v|=1)
        expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });
    it("cosineSimilarity 正交归一化向量点积为 0", () => {
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
    });
    it("batchCosineSimilarity 返回正确维度", () => {
        const query = [1, 0];
        const docs = [[1, 0], [0, 1], [-1, 0]];
        const scores = batchCosineSimilarity(query, docs);
        expect(scores).toHaveLength(3);
        expect(scores[0]).toBeCloseTo(1, 5);
        expect(scores[1]).toBeCloseTo(0, 5);
        expect(scores[2]).toBeCloseTo(-1, 5);
    });
});
describe("@cortex/memory-store — 默认配置", () => {
    it("DEFAULT_HYBRID_CONFIG 可访问", () => {
        expect(DEFAULT_HYBRID_CONFIG).toBeDefined();
        expect(typeof DEFAULT_HYBRID_CONFIG.alpha).toBe("number");
    });
    it("DEFAULT_COGNITIVE_CONFIG 含评分权重", () => {
        expect(DEFAULT_COGNITIVE_CONFIG).toBeDefined();
        expect(typeof DEFAULT_COGNITIVE_CONFIG.weightHybrid).toBe("number");
        expect(typeof DEFAULT_COGNITIVE_CONFIG.weightBayesian).toBe("number");
    });
});
//# sourceMappingURL=pure-functions.test.js.map