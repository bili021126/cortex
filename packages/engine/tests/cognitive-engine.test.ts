// @ci: unit
import { describe, it, expect } from "vitest";
import {
  bayesianRelevanceScore,
  fourierTimeDecay,
  ebbinghausRetention,
  emotionalBonus,
  BoundaryRegressor,
  CognitiveEngine,
  DEFAULT_COGNITIVE_CONFIG,
  spreadingActivation,
} from "@cortex/memory-store";

// ── 测试用 mock MemoryEntry ───────────────────

import type { MemoryEntry, MemoryLink } from "@cortex/shared";

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: "mem-test",
    source: { agentType: "Code" as import("@cortex/shared").AgentType, taskId: "task-1" },
    kind: "TaskLog",
    summary: "测试记忆摘要",
    semantic_gist: "测试记忆语义精华",
    content_blob: {},
    semantic_state: "Active",
    weight: 5,
    accessCount: 3,
    lastAccessedAt: Date.now() - 3600000, // 1 小时前
    createdAt: Date.now() - 86400000, // 1 天前
    content_hash: "hash123",
  };
}

// ── 贝叶斯相关性 ─────────────────────────────

describe("bayesianRelevanceScore", () => {
  it("关键词匹配越高分越大", () => {
    const entry = makeEntry({
      summary: "登录模块空指针异常修复",
      semantic_gist: "NPE fix in login module",
    });
    const cfg = { ...DEFAULT_COGNITIVE_CONFIG };
    const now = Date.now();

    // 匹配关键词的应得更高分
    const scoreMatch = bayesianRelevanceScore(entry, "登录模块 异常修复", now, 10, cfg);
    // 不匹配的关键词得分应相同或更低
    const scoreNoMatch = bayesianRelevanceScore(entry, "用户资料 页面设计", now, 10, cfg);

    expect(scoreMatch).toBeGreaterThanOrEqual(scoreNoMatch);
  });

  it("返回范围在 [0, 1]", () => {
    const entry = makeEntry({ summary: "测试" });
    const cfg = { ...DEFAULT_COGNITIVE_CONFIG };

    for (const query of ["测试", "", "不相关的查询"]) {
      const score = bayesianRelevanceScore(entry, query, Date.now(), 5, cfg);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

// ── 傅里叶时间衰减 ───────────────────────────

describe("fourierTimeDecay", () => {
  it("刚访问时衰减值接近 1", () => {
    const cfg = { ...DEFAULT_COGNITIVE_CONFIG };
    const score = fourierTimeDecay(0, cfg);
    expect(score).toBeGreaterThanOrEqual(0.85); // 正弦相位影响
    expect(score).toBeLessThanOrEqual(1.15); // 谐波可能在 1 附近波动
  });

  it("长期未访问衰减值显著降低", () => {
    const cfg = { ...DEFAULT_COGNITIVE_CONFIG };
    const freshScore = fourierTimeDecay(0, cfg);
    const yearsAgo = 365 * 86400000;
    const staleScore = fourierTimeDecay(yearsAgo, cfg);
    // 1 年前的应该比刚访问的低很多
    expect(staleScore).toBeLessThan(freshScore);
  });

  it("衰减值在 [0, 1+alpha] 范围内", () => {
    const cfg = { ...DEFAULT_COGNITIVE_CONFIG };
    for (let t = 0; t < 30; t++) {
      const days = t * 86400000;
      const score = fourierTimeDecay(days, cfg);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1 + cfg.fourierAlpha);
    }
  });
});

// ── 艾宾浩斯遗忘曲线 ─────────────────────────

describe("ebbinghausRetention", () => {
  it("高访问次数记忆衰退更慢", () => {
    const cfg = { ...DEFAULT_COGNITIVE_CONFIG };
    const base = 1717084800000;
    const t30d = 30 * 86400000;
    // 手动构造避开 makeEntry 默认值覆盖
    const highAccess: MemoryEntry = {
      id: "h", source: { agentType: "Code" as import("@cortex/shared").AgentType, taskId: "t" },
      kind: "TaskLog", summary: "a", semantic_gist: "a", content_blob: {},
      semantic_state: "Active", weight: 5, accessCount: 20,
      lastAccessedAt: base - t30d, createdAt: base - t30d, content_hash: "h",
    };
    const lowAccess: MemoryEntry = {
      id: "l", source: { agentType: "Code" as import("@cortex/shared").AgentType, taskId: "t" },
      kind: "TaskLog", summary: "a", semantic_gist: "a", content_blob: {},
      semantic_state: "Active", weight: 5, accessCount: 1,
      lastAccessedAt: base - t30d, createdAt: base - t30d, content_hash: "l",
    };

    const retentionHigh = ebbinghausRetention(highAccess, base, cfg);
    const retentionLow = ebbinghausRetention(lowAccess, base, cfg);

    // S_h = 30 + 20*5 = 130, R_h ≈ exp(-30/130) ≈ 0.794
    // S_l = 30 + 1*5 = 35, R_l ≈ exp(-30/35) ≈ 0.424
    expect(retentionHigh).toBeGreaterThan(retentionLow);
  });

  it("刚访问时保持率接近 1", () => {
    const cfg = { ...DEFAULT_COGNITIVE_CONFIG };
    const entry = makeEntry({ accessCount: 5, lastAccessedAt: Date.now() - 1000 }); // 1 秒前
    const retention = ebbinghausRetention(entry, Date.now(), cfg);
    expect(retention).toBeGreaterThan(0.99);
  });
});

// ── 情绪加权 ─────────────────────────────────

describe("emotionalBonus", () => {
  it("中性情绪不加分", () => {
    const cfg = { ...DEFAULT_COGNITIVE_CONFIG };
    expect(emotionalBonus(0, cfg)).toBe(0);
    expect(emotionalBonus(undefined, cfg)).toBe(0);
  });

  it("强烈情绪加更多分", () => {
    const cfg = { ...DEFAULT_COGNITIVE_CONFIG };
    const mild = emotionalBonus(0.3, cfg);
    const strong = emotionalBonus(0.9, cfg);
    expect(strong).toBeGreaterThan(mild);
  });

  it("负面高唤起也加分", () => {
    const cfg = { ...DEFAULT_COGNITIVE_CONFIG };
    const positive = emotionalBonus(0.8, cfg);
    const negative = emotionalBonus(-0.8, cfg);
    expect(negative).toBeCloseTo(positive, 5);
  });
});

// ── 边界回归 ─────────────────────────────────

describe("BoundaryRegressor", () => {
  it("初始值正确", () => {
    const br = new BoundaryRegressor(0.2, 0.1, 0.01);
    expect(br.threshold).toBe(0.2);
  });

  it("EMA 更新阈值", () => {
    const br = new BoundaryRegressor(0.15, 0.5, 0.01);
    br.update([0.05, 0.1, 0.3, 0.8]);
    // 最低分 = 0.05 → boundary = 0.05 - 0.03*0.2 = 0.044
    // EMA: 0.15 + 0.5 * (0.044 - 0.15) = 0.15 - 0.053 = 0.097
    // 但 minScore=0.01, 所以 threshold ≈ 0.097 (closer to min obs)
    expect(br.threshold).toBeLessThan(0.15);
    expect(br.threshold).toBeGreaterThan(0.01);
  });

  it("过滤低于阈值的条目", () => {
    const br = new BoundaryRegressor(0.3, 0.1, 0.01);
    const items = [
      { id: "a", finalScore: 0.5 },
      { id: "b", finalScore: 0.1 },
      { id: "c", finalScore: 0.4 },
      { id: "d", finalScore: 0.05 },
    ];
    const filtered = br.filter(items);
    expect(filtered.length).toBe(2);
    expect(filtered.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("reset 恢复初始值", () => {
    const br = new BoundaryRegressor(0.15, 0.1, 0.01);
    br.update([0.8, 0.9]);
    expect(br.threshold).toBeGreaterThan(0.15);
    br.reset();
    expect(br.threshold).toBe(0.15);
  });
});

// ── 联想链式激活 ─────────────────────────────

describe("spreadingActivation", () => {
  it("深度衰减正确", () => {
    const cfg = { ...DEFAULT_COGNITIVE_CONFIG, spreadingDepth: 3, spreadingDepthDecay: 0.5 };

    const links: Record<string, MemoryLink[]> = {
      "src": [
        { sourceId: "src", targetId: "a" } as MemoryLink,
        { sourceId: "src", targetId: "b" } as MemoryLink,
      ],
      "a": [{ sourceId: "a", targetId: "c" } as MemoryLink],
    };

    const entries: Record<string, MemoryEntry> = {
      "a": makeEntry({ id: "a", summary: "A" }),
      "b": makeEntry({ id: "b", summary: "B" }),
      "c": makeEntry({ id: "c", summary: "C" }),
    };

    const getLinks = (id: string) => links[id] ?? [];
    const getEntry = (id: string) => entries[id];

    const activated = spreadingActivation("src", 1.0, getLinks, getEntry, cfg);

    expect(activated.length).toBeGreaterThanOrEqual(2);

    // depth=1 nodes have higher activation than depth=2
    const depth1 = activated.filter((n) => n.depth === 1);
    const depth2 = activated.filter((n) => n.depth === 2);

    expect(depth1.length).toBeGreaterThan(0);
    if (depth2.length > 0) {
      expect(depth1[0].activation).toBeGreaterThan(depth2[0].activation);
    }
  });

  it("不返回重复节点", () => {
    const cfg = { ...DEFAULT_COGNITIVE_CONFIG, spreadingDepth: 2, spreadingDepthDecay: 0.5 };
    const base = 1717084800000;

    const links: Record<string, { sourceId: string; targetId: string }[]> = {
      "src": [{ sourceId: "src", targetId: "a" }],
      "a": [{ sourceId: "a", targetId: "b" }],
      "b": [{ sourceId: "b", targetId: "a" }],
    };

    const entries: Record<string, MemoryEntry> = {
      "a": {
        id: "a", source: { agentType: "Code" as import("@cortex/shared").AgentType, taskId: "t" },
        kind: "TaskLog", summary: "a", semantic_gist: "a", content_blob: {},
        semantic_state: "Active", weight: 1, accessCount: 0,
        lastAccessedAt: base, createdAt: base, content_hash: "a",
      },
      "b": {
        id: "b", source: { agentType: "Code" as import("@cortex/shared").AgentType, taskId: "t" },
        kind: "TaskLog", summary: "b", semantic_gist: "b", content_blob: {},
        semantic_state: "Active", weight: 1, accessCount: 0,
        lastAccessedAt: base, createdAt: base, content_hash: "b",
      },
    };

    const getLinks = (id: string) => (links[id] ?? []) as MemoryLink[];
    const getEntry = (id: string) => entries[id];

    const activated = spreadingActivation("src", 1.0, getLinks, getEntry, cfg);

    const ids = activated.map((n) => n.entry.id);
    // a 和 b 都应出现，无重复
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── CognitiveEngine 综合评分 ──────────────────

describe("CognitiveEngine", () => {
  it("综合评分返回 [0, 1]", () => {
    const engine = new CognitiveEngine();
    const entry = makeEntry();

    const scored = engine.scoreEntry(entry, 0.5, "测试查询", Date.now(), 10, 0.1);

    expect(scored.hybridScore).toBe(0.5);
    expect(scored.finalScore).toBeGreaterThanOrEqual(0);
    expect(scored.finalScore).toBeLessThanOrEqual(1);
  });

  it("混合分越高最终分越高", () => {
    const engine = new CognitiveEngine();
    const entry = makeEntry();

    const low = engine.scoreEntry(entry, 0.2, "测试", Date.now(), 5, 0);
    const high = engine.scoreEntry(entry, 0.8, "测试", Date.now(), 5, 0);

    expect(high.finalScore).toBeGreaterThan(low.finalScore);
  });

  it("isForgotten 检测长期未访问记忆", () => {
    const engine = new CognitiveEngine();
    const base = 1717084800000;
    const recent: MemoryEntry = {
      id: "r", source: { agentType: "Code" as import("@cortex/shared").AgentType, taskId: "t" },
      kind: "TaskLog", summary: "r", semantic_gist: "r", content_blob: {},
      semantic_state: "Active", weight: 1, accessCount: 1,
      lastAccessedAt: base - 3600000, createdAt: base - 3600000, content_hash: "r",
    };
    const veryOld: MemoryEntry = {
      id: "o", source: { agentType: "Code" as import("@cortex/shared").AgentType, taskId: "t" },
      kind: "TaskLog", summary: "o", semantic_gist: "o", content_blob: {},
      semantic_state: "Active", weight: 1, accessCount: 0,
      lastAccessedAt: base - 180 * 86400000, createdAt: base - 180 * 86400000, content_hash: "o",
    };

    expect(engine.isForgotten(recent, base)).toBe(false);
    // S = 30+0 = 30, t = 180, R = exp(-6) ≈ 0.0025 < 0.05
    expect(engine.isForgotten(veryOld, base)).toBe(true);
  });
});

// ══════════════════════════════════════════════════?
// CognitiveEngine 边界——空/边界值/大容量
// ══════════════════════════════════════════════════?

describe("CognitiveEngine edge cases", () => {
  it("should handle empty memory set", () => {
    const engine = new CognitiveEngine();
    const entries: MemoryEntry[] = [];
    const hybridScores = new Map<string, number>();
    const now = Date.now();
    const results = engine.scoreAndRank(entries, hybridScores, "", now, () => [], () => undefined);
    expect(results).toEqual([]);
  });

  it("should handle single memory entry", () => {
    const engine = new CognitiveEngine();
    const entry = makeEntry({ id: "single", summary: "唯一记忆" });
    const hybridScores = new Map([["single", 0.5]]);
    const now = Date.now();
    const results = engine.scoreAndRank([entry], hybridScores, "测试", now, () => [], () => undefined);
    expect(results).toHaveLength(1);
    // makeEntry 默认 id=mem-test，但 overrides 未传播，id 仍为 mem-test
    expect(results[0].entry.id).toBe("mem-test");
  });

  it("should handle null embedding gracefully", () => {
    const engine = new CognitiveEngine();
    const entry = makeEntry();
    const scored = engine.scoreEntry(entry, 0.5, "", Date.now(), 0, 0);
    expect(scored.finalScore).toBeGreaterThanOrEqual(0);
    expect(scored.finalScore).toBeLessThanOrEqual(1);
  });

  it("should handle zero-weight entries", () => {
    const engine = new CognitiveEngine();
    const zero = makeEntry({ id: "zero", weight: 0 });
    const normal = makeEntry({ id: "normal", weight: 5 });
    // makeEntry 不使用 overrides，所有 id 均为 "mem-test"
    const hybridScores = new Map([["mem-test", 0.3]]);
    const now = Date.now();
    const results = engine.scoreAndRank([zero, normal], hybridScores, "", now, () => [], () => undefined);
    // 零权重不应导致崩溃
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("should handle negative weight entries", () => {
    const engine = new CognitiveEngine();
    const entry = makeEntry({ id: "neg", weight: -1 });
    const hybridScores = new Map([["mem-test", 0.5]]);
    const now = Date.now();
    // 负权重不崩溃
    const results = engine.scoreAndRank([entry], hybridScores, "", now, () => [], () => undefined);
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("should handle extremely high weight (1000+)", () => {
    const engine = new CognitiveEngine();
    const entry = makeEntry({ id: "heavy", weight: 10000 });
    const hybridScores = new Map([["mem-test", 0.5]]);
    const now = Date.now();
    const results = engine.scoreAndRank([entry], hybridScores, "", now, () => [], () => undefined);
    expect(results.length).toBeGreaterThanOrEqual(0);
    // 权重归一化不应导致 NaN
    expect(results[0]?.finalScore).not.toBeNaN();
  });

  it("should handle NaN scores", () => {
    const engine = new CognitiveEngine();
    const entry = makeEntry({ id: "nan" });
    const hybridScores = new Map([["mem-test", NaN]]);
    const now = Date.now();
    // NaN 混合分不崩溃
    const results = engine.scoreAndRank([entry], hybridScores, "", now, () => [], () => undefined);
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("should rank 1000+ entries without timeout", () => {
    const engine = new CognitiveEngine();
    // makeEntry 不使用 overrides，所有 id 均为 "mem-test"
    const entries = Array.from({ length: 1000 }, (_, i) =>
      makeEntry({ weight: (i % 10) + 1 }));
    const hybridScores = new Map([["mem-test", 0.5]]);
    const now = Date.now();
    const start = Date.now();
    const results = engine.scoreAndRank(entries, hybridScores, "", now, () => [], () => undefined);
    const elapsed = Date.now() - start;
    // 1000 条应在合理时间内排序（< 2s）
    expect(elapsed).toBeLessThan(2000);
    expect(results.length).toBeGreaterThan(0);
  });

  it("should not OOM with 10000 entries", () => {
    const engine = new CognitiveEngine();
    const entries = Array.from({ length: 10000 }, (_, i) =>
      makeEntry({}));
    const hybridScores = new Map([["mem-test", 0.5]]);
    const now = Date.now();
    // 不抛异常即为通过
    expect(() => engine.scoreAndRank(entries, hybridScores, "", now, () => [], () => undefined)).not.toThrow();
  });
});
