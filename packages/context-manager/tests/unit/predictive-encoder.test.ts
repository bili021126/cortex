/**
 * @cortex/context-manager — PredictiveEncoder 单元测试
 *
 * 验证记忆条目与场景/人物的关联编码逻辑：
 *   - scene rules 规则匹配
 *   - decayCurve 生成正确
 *   - content 使用 summary
 *   - embedding 缺失时兜底
 */
import { describe, it, expect } from "vitest";
import { PredictiveEncoder } from "../../src/predictive-encoder.js";
import type { MemoryEntry } from "@cortex/shared";

function makeEntry(overrides?: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: "test-entry-1",
    source: "agent",
    kind: "Insight",
    summary: overrides?.summary ?? "default summary",
    semantic_gist: "test gist",
    content_blob: { key: "value" },
    semantic_state: "Active",
    weight: overrides?.weight ?? 1.0,
    accessCount: 0,
    lastAccessedAt: Date.now(),
    createdAt: Date.now() - 1000,
    content_hash: "abc123",
    ...overrides,
  } as MemoryEntry;
}

describe("PredictiveEncoder", () => {
  const encoder = new PredictiveEncoder();

  it("should encode with default scene rules", () => {
    const entry = makeEntry({ summary: "fix a bug in parser" });
    const result = encoder.encode(entry, {
      scene: "code-repair",
      persona: "cyrene",
    });

    expect(result.relevancePredict.scenes).toContain("code-repair");
    expect(result.relevancePredict.scenes).toContain("code-review");
    expect(result.relevancePredict.scenes).toContain("architecture");
  });

  it("should generate decay curve for given weight", () => {
    const entry = makeEntry({ weight: 0.8 });
    const result = encoder.encode(entry, {
      scene: "general",
      persona: "cyrene",
    });

    expect(result.relevancePredict.decayCurve).toHaveLength(10);
    // 第一项 = weight * 1.0 = 0.8
    expect(result.relevancePredict.decayCurve[0]).toBeCloseTo(0.8);
    // 最后一项 > 0 （weight * (1 - 9/10) = 0.08）
    expect(result.relevancePredict.decayCurve[9]).toBeCloseTo(0.08, 2);
    // 严格递减
    for (let i = 1; i < result.relevancePredict.decayCurve.length; i++) {
      expect(result.relevancePredict.decayCurve[i]).toBeLessThanOrEqual(
        result.relevancePredict.decayCurve[i - 1],
      );
    }
  });

  it("should use summary field as content", () => {
    const entry = makeEntry({ summary: "the quick brown fox" });
    const result = encoder.encode(entry, {
      scene: "general",
      persona: "cyrene",
    });

    expect(result.content).toBe("the quick brown fox");
  });

  it("should handle missing embedding gracefully", () => {
    // 不传 embedding
    const entry = makeEntry({ embedding: undefined });
    const result = encoder.encode(entry, {
      scene: "code-review",
      persona: "cyrene",
    });

    expect(result.embedding).toEqual([]);
  });

  it("should include embedding when present", () => {
    const entry = makeEntry({ embedding: [0.1, 0.2, 0.3] });
    const result = encoder.encode(entry, {
      scene: "code-review",
      persona: "cyrene",
    });

    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("should default unknown scene to general", () => {
    const entry = makeEntry();
    const result = encoder.encode(entry, {
      scene: "nonexistent-scene",
      persona: "cyrene",
    });

    expect(result.relevancePredict.scenes).toEqual(["general"]);
  });
});
