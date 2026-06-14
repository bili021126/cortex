// @ci: unit
// ============================================================
// bm25-index.test.ts — BM25 全文索引单元测试
//
// 覆盖：tokenize 分词、文档增删、BM25 搜索、统计快照
// ============================================================

import { describe, it, expect } from "vitest";
import { BM25Index, tokenize } from "@cortex/memory-store";
import type { BM25Stats } from "@cortex/memory-store";

// ── tokenize ──────────────────────────────────

describe("tokenize", () => {
  it("空字符串返回空数组", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("英文分词：按空白切分、小写化、过滤停用词", () => {
    const tokens = tokenize("The quick brown fox");
    // "the" 是停用词
    expect(tokens).toContain("quick");
    expect(tokens).toContain("brown");
    expect(tokens).toContain("fox");
    expect(tokens).not.toContain("the");
  });

  it("中文分词：逐字切分、过滤停用词", () => {
    const tokens = tokenize("我是一个测试");
    // "我","是","一" 是停用词
    expect(tokens).toContain("个");
    expect(tokens).toContain("测");
    expect(tokens).toContain("试");
    expect(tokens).not.toContain("我");
    expect(tokens).not.toContain("是");
  });

  it("中英混合分词", () => {
    const tokens = tokenize("测试 test 123 数据");
    expect(tokens).toContain("测");
    expect(tokens).toContain("试");
    expect(tokens).toContain("test");
    expect(tokens).toContain("123");
    expect(tokens).toContain("数");
    expect(tokens).toContain("据");
  });
});

// ── BM25Index ─────────────────────────────────

describe("BM25Index", () => {
  it("初始 stats 全为零", () => {
    const idx = new BM25Index();
    const stats: BM25Stats = idx.stats;
    expect(stats.docCount).toBe(0);
    expect(stats.avgDocLength).toBe(0);
    expect(stats.totalTerms).toBe(0);
  });

  it("addDocument 增加文档并更新统计", () => {
    const idx = new BM25Index();
    idx.addDocument("d1", { summary: "hello world", semantic_gist: "test memory" });

    expect(idx.docCount).toBe(1);
    expect(idx.stats.docCount).toBe(1);
    expect(idx.stats.totalTerms).toBeGreaterThan(0);
  });

  it("addDocument 同名覆盖旧文档", () => {
    const idx = new BM25Index();
    idx.addDocument("d1", { summary: "first version" });
    idx.addDocument("d1", { summary: "second version much longer text here" });

    expect(idx.docCount).toBe(1);
  });

  it("removeDocument 删除文档并更新统计", () => {
    const idx = new BM25Index();
    idx.addDocument("d1", { summary: "hello world" });
    expect(idx.docCount).toBe(1);

    idx.removeDocument("d1");
    expect(idx.docCount).toBe(0);
  });

  it("removeDocument 对不存在文档幂等", () => {
    const idx = new BM25Index();
    expect(() => idx.removeDocument("nonexistent")).not.toThrow();
    expect(idx.docCount).toBe(0);
  });

  it("空索引搜索返回空数组", () => {
    const idx = new BM25Index();
    expect(idx.search("anything")).toEqual([]);
  });

  it("空查询返回空数组", () => {
    const idx = new BM25Index();
    idx.addDocument("d1", { summary: "hello world" });
    expect(idx.search("")).toEqual([]);
  });

  it("BM25 搜索返回相关文档并按分降序", () => {
    const idx = new BM25Index();
    idx.addDocument("d1", { summary: "machine learning with neural networks" });
    idx.addDocument("d2", { summary: "deep learning neural network training" });
    idx.addDocument("d3", { summary: "cooking recipes for pasta" });

    const results = idx.search("neural network learning");
    expect(results.length).toBeGreaterThan(0);
    // d2 应该有 "neural", "network", "learning" 三个词命中 → 分最高
    expect(results[0].id).toBe("d2");
    // d1 应该有 "neural" 命中
    const d1Result = results.find((r: { id: string }) => r.id === "d1");
    expect(d1Result).toBeDefined();
    // d3 不应该在结果中
    const d3Result = results.find((r: { id: string }) => r.id === "d3");
    expect(d3Result).toBeUndefined();
  });

  it("多字段加权搜索——summary 权重默认 2", () => {
    const idx = new BM25Index();
    // d1: 查询词在 summary（权重 2）中
    idx.addDocument("d1", { summary: "redis cache", semantic_gist: "unrelated" });
    // d2: 查询词在 semantic_gist（权重 1）中
    idx.addDocument("d2", { summary: "unrelated", semantic_gist: "redis cache" });

    const results = idx.search("redis");
    expect(results.length).toBe(2);
    // d1 的 summary 权重更高 → 排前面
    expect(results[0].id).toBe("d1");
  });

  it("topN 限制返回数量", () => {
    const idx = new BM25Index();
    for (let i = 0; i < 10; i++) {
      idx.addDocument(`d${i}`, { summary: `test memory entry number ${i}` });
    }

    const results = idx.search("test memory", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("可自定义字段权重", () => {
    const idx = new BM25Index({ summary: 1, semantic_gist: 3, payload: 0.1 });
    // d1: 查询词在 payload（权重 0.1）
    idx.addDocument("d1", { payload: "redis cache", summary: "unrelated" });
    // d2: 查询词在 summary（权重 1）
    idx.addDocument("d2", { summary: "redis cache" });

    const results = idx.search("redis");
    expect(results.length).toBe(2);
    // d2 的 summary 权重更高（1 > 0.1）
    expect(results[0].id).toBe("d2");
  });

  it("可自定义 BM25 参数——不抛错且结果一致", () => {
    const idx = new BM25Index({ summary: 1.5 }, 1.5, 0.8);
    idx.addDocument("d1", { summary: "machine learning with neural networks" });
    idx.addDocument("d2", { summary: "cooking recipes for pasta" });

    const results = idx.search("neural network");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("d1");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("avgDocLength 正确计算", () => {
    const idx = new BM25Index();
    idx.addDocument("d1", { summary: "short doc" });          // 2 tokens
    idx.addDocument("d2", { summary: "a much longer document here" }); // ~4 tokens

    const avg = idx.stats.avgDocLength;
    expect(avg).toBeGreaterThan(0);
    // 平均长度应该在 min 和 max 之间
    expect(avg).toBeGreaterThanOrEqual(2);
  });
});
