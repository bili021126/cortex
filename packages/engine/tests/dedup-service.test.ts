// @ci: unit
/**
 * 测试文件: DedupService 内容去重服务
 *
 * @since v3.1.0
 *
 * 测试范围:
 * - contentHash() — SHA256 确定性
 * - exactMatch() — content_hash 精确匹配
 * - vectorDedup() — 余弦相似度去重
 * - 边界: 空向量, 零向量, 不同维度, 空池
 */

import { describe, it, expect } from "vitest";
import { DedupService } from "@cortex/memory-store";
import type { MemoryEntry } from "@cortex/shared";
import { AgentType } from "@cortex/shared";

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: "mem-001",
    source: { agentType: AgentType.Code, taskId: "task-1" },
    kind: "TaskLog",
    summary: "测试记忆",
    semantic_gist: "测试记忆",
    content_blob: {},
    semantic_state: "Active",
    weight: 1.0,
    accessCount: 1,
    lastAccessedAt: Date.now(),
    createdAt: Date.now(),
    content_hash: "",
    ...overrides,
  };
}

describe("DedupService.contentHash", () => {
  it("相同输入产生相同哈希", () => {
    const svc = new DedupService();
    const h1 = svc.contentHash("hello", { a: 1 });
    const h2 = svc.contentHash("hello", { a: 1 });
    expect(h1).toBe(h2);
  });

  it("不同 summary 产生不同哈希", () => {
    const svc = new DedupService();
    const h1 = svc.contentHash("hello", {});
    const h2 = svc.contentHash("world", {});
    expect(h1).not.toBe(h2);
  });

  it("不同 content_blob 产生不同哈希", () => {
    const svc = new DedupService();
    const h1 = svc.contentHash("same", { a: 1 });
    const h2 = svc.contentHash("same", { a: 2 });
    expect(h1).not.toBe(h2);
  });

  it("哈希为 64 字符十六进制 (SHA256)", () => {
    const svc = new DedupService();
    const hash = svc.contentHash("test", {});
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("DedupService.exactMatch", () => {
  it("content_hash 匹配 → 返回条目 ID", () => {
    const svc = new DedupService();
    const entries = [
      makeEntry({ id: "existing-1", content_hash: "abc123" }),
    ];
    expect(svc.exactMatch("abc123", entries)).toBe("existing-1");
  });

  it("content_hash 不匹配 → 返回 null", () => {
    const svc = new DedupService();
    const entries = [
      makeEntry({ id: "existing-1", content_hash: "abc123" }),
    ];
    expect(svc.exactMatch("xyz789", entries)).toBeNull();
  });

  it("空条目池 → 返回 null", () => {
    const svc = new DedupService();
    expect(svc.exactMatch("abc123", [])).toBeNull();
  });

  it("多条目中匹配第一个", () => {
    const svc = new DedupService();
    const entries = [
      makeEntry({ id: "a", content_hash: "aaa" }),
      makeEntry({ id: "b", content_hash: "bbb" }),
      makeEntry({ id: "c", content_hash: "ccc" }),
    ];
    expect(svc.exactMatch("bbb", entries)).toBe("b");
  });
});

describe("DedupService.vectorDedup", () => {
  it("完全相同向量 → 余弦 1.0", () => {
    const svc = new DedupService("sha256", 0.95);
    const entries = [
      makeEntry({ id: "dup", embedding: [1, 0, 0] }),
    ];
    const matches = svc.vectorDedup([1, 0, 0], entries);
    expect(matches).toHaveLength(1);
    expect(matches[0].existingId).toBe("dup");
    expect(matches[0].similarity).toBeCloseTo(1.0, 6);
  });

  it("正交向量 → 余弦 0.0 → 不匹配", () => {
    const svc = new DedupService("sha256", 0.95);
    const entries = [
      makeEntry({ id: "ortho", embedding: [1, 0, 0] }),
    ];
    const matches = svc.vectorDedup([0, 1, 0], entries);
    expect(matches).toHaveLength(0);
  });

  it("相似度低于阈值 → 不匹配", () => {
    const svc = new DedupService("sha256", 0.95);
    const entries = [
      makeEntry({ id: "low", embedding: [1, 0] }),
    ];
    // [0.5, 0.5] 与 [1, 0] 余弦 ≈ 0.707
    const matches = svc.vectorDedup([0.5, 0.5], entries);
    expect(matches).toHaveLength(0);
  });

  it("空 embedding 条目 → 跳过", () => {
    const svc = new DedupService();
    const entries = [
      makeEntry({ id: "no-emb", embedding: undefined }),
    ];
    const matches = svc.vectorDedup([1, 0, 0], entries);
    expect(matches).toHaveLength(0);
  });

  it("不同维度 embedding → 跳过", () => {
    const svc = new DedupService();
    const entries = [
      makeEntry({ id: "bad", embedding: [1, 2, 3] }),
    ];
    const matches = svc.vectorDedup([1, 0], entries);
    expect(matches).toHaveLength(0);
  });

  it("零向量（newEmbedding）→ 无匹配", () => {
    const svc = new DedupService();
    const entries = [
      makeEntry({ id: "dup", embedding: [1, 0, 0] }),
    ];
    const matches = svc.vectorDedup([0, 0, 0], entries);
    expect(matches).toHaveLength(0);
  });

  it("零向量条目 → 跳过", () => {
    const svc = new DedupService();
    const entries = [
      makeEntry({ id: "zero", embedding: [0, 0, 0] }),
    ];
    const matches = svc.vectorDedup([1, 0, 0], entries);
    expect(matches).toHaveLength(0);
  });

  it("空条目池 → 空匹配", () => {
    const svc = new DedupService();
    expect(svc.vectorDedup([1, 2, 3], [])).toEqual([]);
  });

  it("多个匹配——按相似度降序排列", () => {
    const svc = new DedupService("sha256", 0.80);
    const entries = [
      makeEntry({ id: "a", embedding: [1, 0, 0] }),      // cos ≈ 1.0
      makeEntry({ id: "b", embedding: [0.9, 0.1, 0] }),  // cos ≈ 0.994
      makeEntry({ id: "c", embedding: [0.8, 0.2, 0] }),  // cos ≈ 0.970
    ];
    const matches = svc.vectorDedup([1, 0, 0], entries);
    expect(matches).toHaveLength(3);
    expect(matches[0].existingId).toBe("a");
    expect(matches[0].similarity).toBeCloseTo(1.0, 6);
    expect(matches[1].similarity).toBeGreaterThan(matches[2].similarity);
  });

  it("自定义 vectorThreshold", () => {
    const svc = new DedupService("sha256", 0.99);
    const entries = [
      makeEntry({ id: "d", embedding: [1, 0, 0] }),
      makeEntry({ id: "e", embedding: [0.98, 0.02, 0] }), // cos ≈ 0.9998
    ];
    const matches = svc.vectorDedup([1, 0, 0], entries);
    // 阈值 0.99, [0.98, 0.02, 0] cos ≈ 0.9998 > 0.99 → 匹配
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches).toHaveLength(2);
  });
});
