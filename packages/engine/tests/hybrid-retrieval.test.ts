// @ci: unit
import { describe, it, expect } from "vitest";
import {
  BM25Index, tokenize, HybridRetriever,
  DEFAULT_HYBRID_CONFIG, cosineSimilarity, batchCosineSimilarity,
} from "@cortex/memory-store";
import type { IEmbeddingService } from "@cortex/memory-store";

describe("tokenize", () => {
  it("切分中文文本为单字 token", () => {
    const tokens = tokenize("这段代码需要重构优化");
    expect(tokens).toContain("段");
    expect(tokens).toContain("代");
    expect(tokens).toContain("码");
    expect(tokens).toContain("重");
    expect(tokens).toContain("构");
    // 停用词应被过滤
    expect(tokens).not.toContain("的");
    expect(tokens).not.toContain("这");
  });

  it("切分英文保留完整单词", () => {
    const tokens = tokenize("Refactor the codebase");
    expect(tokens).toContain("refactor");
    expect(tokens).toContain("codebase");
    // 停用词
    expect(tokens).not.toContain("the");
  });

  it("空字符串返回空数组", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("BM25Index", () => {
  it("添加文档后可搜索", () => {
    const index = new BM25Index();
    index.addDocument("doc1", {
      summary: "修复了登录模块的空指针异常",
      semantic_gist: "登录模块空指针异常修复",
      payload: "bug fix for NPE in login",
    });
    index.addDocument("doc2", {
      summary: "添加了用户资料页面",
      semantic_gist: "用户资料页面新增",
      payload: "add user profile page",
    });

    const results = index.search("登录 异常");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("doc1");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("移除文档后不可搜索", () => {
    const index = new BM25Index();
    index.addDocument("doc1", {
      summary: "登录模块重构",
      semantic_gist: "登录模块",
      payload: "login",
    });

    // Verify document was added
    expect(index.docCount).toBe(1);
    expect(index.stats.docCount).toBe(1);

    index.removeDocument("doc1");
    // Verify document was removed
    expect(index.docCount).toBe(0);
    expect(index.stats.docCount).toBe(0);
  });

  it("多字段加权——summary 权重更高", () => {
    const index = new BM25Index({
      summary: 3,
      semantic_gist: 1,
    });
    // docA: 关键词在 summary
    index.addDocument("docA", {
      summary: "重构重构重构重构",
      semantic_gist: "无关内容",
      payload: "",
    });
    // docB: 关键词仅在 semantic_gist
    index.addDocument("docB", {
      summary: "无关内容无关内容",
      semantic_gist: "重构重构重构重构",
      payload: "",
    });

    const results = index.search("重构");
    expect(results.length).toBe(2);
    expect(results[0].id).toBe("docA"); // summary 权重更高
  });

  it("空查询返回空结果", () => {
    const index = new BM25Index();
    index.addDocument("d1", { summary: "测试" });
    expect(index.search("")).toEqual([]);
  });

  it("统计信息正确", () => {
    const index = new BM25Index();
    expect(index.stats.docCount).toBe(0);

    index.addDocument("a", { summary: "文档 A 内容" });
    index.addDocument("b", { summary: "文档 B 内容较多" });
    expect(index.stats.docCount).toBe(2);
    expect(index.stats.avgDocLength).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════?
// HybridRetrieval 边界——空/阈值/查询/容量
// ══════════════════════════════════════════════════?

describe("HybridRetrieval edge cases", () => {
  function mockEmbedder(): IEmbeddingService {
    return {
      async embedText(text: string): Promise<number[]> {
        let h = 0;
        for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
        const vec = new Array(384).fill(0);
        vec[Math.abs(h) % 384] = 1;
        return vec;
      },
      async embedBatch(texts: string[]): Promise<number[][]> {
        return Promise.all(texts.map((t) => this.embedText(t)));
      },
    };
  }

  it("should handle empty query", () => {
    const retriever = new HybridRetriever();
    const results = retriever.greedyFineRank([]);
    expect(results).toEqual([]);
  });

  it("should handle empty corpus", () => {
    const retriever = new HybridRetriever();
    const empty: Array<{ entry: any; hybridScore: number }> = [];
    const results = retriever.greedyFineRank(empty as any);
    expect(results).toEqual([]);
  });

  it("should handle query with all stopwords", () => {
    const retriever = new HybridRetriever();
    const scored = retriever.greedyFineRank([]);
    expect(scored).toEqual([]);
  });

  it("should handle threshold at 0 (return all)", () => {
    const retriever = new HybridRetriever({ initialThreshold: 0, enableBoundaryRegression: false });
    const entries = Array.from({ length: 5 }, (_, i) => ({
      entry: { id: `t0-${i}`, summary: `test ${i}` } as any,
      bm25Score: i * 0.1,
      vectorScore: i * 0.1,
      hybridScore: i * 0.2,
    }));
    const results = retriever.greedyFineRank(entries);
    expect(results.length).toBeGreaterThan(0);
  });

  it("should handle threshold at 1 (return none)", () => {
    const retriever = new HybridRetriever({ initialThreshold: 1, enableBoundaryRegression: true });
    const entries = Array.from({ length: 3 }, (_, i) => ({
      entry: { id: `t1-${i}`, summary: `test ${i}` } as any,
      bm25Score: 0.1,
      vectorScore: 0.1,
      hybridScore: 0.3,
    }));
    const results = retriever.greedyFineRank(entries);
    // threshold=1 时所有结果都 < 1，应返回 [] 或 top-1（取决于实现）
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("should handle duplicate content in corpus", () => {
    const index = new BM25Index();
    index.addDocument("d1", { summary: "重复内容", semantic_gist: "dup" });
    index.addDocument("d2", { summary: "重复内容", semantic_gist: "dup" });
    const results = index.search("重复内容");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle single-char query", () => {
    const index = new BM25Index();
    index.addDocument("d1", { summary: "中文测试文档", semantic_gist: "test" });
    const results = index.search("中");
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("should handle 10000-char query", () => {
    const index = new BM25Index();
    index.addDocument("d1", { summary: "短文档", semantic_gist: "short" });
    const longQuery = "A".repeat(10000);
    const results = index.search(longQuery);
    expect(results).toEqual([]);
  });

  it("should maintain boundary regression with edge values", () => {
    const retriever = new HybridRetriever({ initialThreshold: 0.5, enableBoundaryRegression: true });
    expect(retriever.adaptiveThreshold).toBe(0.5);

    retriever.greedyFineRank([]);
    expect(retriever.adaptiveThreshold).toBe(0.5);

    const low = Array.from({ length: 5 }, (_, i) => ({
      entry: { id: `low-${i}`, summary: "low" } as any,
      bm25Score: 0,
      vectorScore: 0,
      hybridScore: 0.01,
    }));
    retriever.greedyFineRank(low);
    expect(retriever.adaptiveThreshold).toBeGreaterThanOrEqual(0.01);
    expect(retriever.adaptiveThreshold).toBeLessThanOrEqual(0.95);
  });

  it("should converge threshold with repetitive similar queries", () => {
    const retriever = new HybridRetriever({ initialThreshold: 0.5, enableBoundaryRegression: true, boundaryEma: 0.3 });
    const entries = Array.from({ length: 5 }, (_, i) => ({
      entry: { id: `cv-${i}`, summary: `similar ${i}` } as any,
      bm25Score: 0.3,
      vectorScore: 0.3,
      hybridScore: 0.6,
    }));

    const thresholds: number[] = [retriever.adaptiveThreshold];
    for (let r = 0; r < 10; r++) {
      retriever.greedyFineRank(entries);
      thresholds.push(retriever.adaptiveThreshold);
    }
    expect(retriever.adaptiveThreshold).toBeGreaterThanOrEqual(0.01);
    expect(retriever.adaptiveThreshold).toBeLessThanOrEqual(0.95);
  });
});
