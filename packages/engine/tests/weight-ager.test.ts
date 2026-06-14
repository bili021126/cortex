// @ci: unit
/**
 * 测试文件: WeightAger 权重老化服务
 *
 * @since v3.1.0
 *
 * 测试范围:
 * - decayWeights() — 按时衰减
 * - freezeStale() — 识别可归档 Active 记忆
 * - obliterateFrozen() — 识别可湮灭 Archived 记忆
 * - 边界条件: 空数组, 0 权重, 参数覆盖
 */

import { describe, it, expect } from "vitest";
import { WeightAger } from "@cortex/memory-store";
import type { MemoryEntry } from "@cortex/shared";
import { AgentType } from "@cortex/shared";

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: "mem-001",
    source: { agentType: AgentType.Code, taskId: "task-1" },
    kind: "TaskLog",
    summary: "测试记忆",
    semantic_gist: "测试记忆",
    content_blob: { test: true },
    semantic_state: "Active",
    weight: 1.0,
    accessCount: 1,
    lastAccessedAt: NOW,
    createdAt: NOW,
    content_hash: "abc123",
    ...overrides,
  };
}

describe("WeightAger.decayWeights", () => {
  it("近期记忆权重不变", () => {
    const ager = new WeightAger();
    const entry = makeEntry({ lastAccessedAt: NOW });
    const result = ager.decayWeights([entry], NOW);
    expect(result[0].weight).toBe(1.0);
  });

  it("7天未访问——衰减 5%", () => {
    const ager = new WeightAger(0.95);
    const entry = makeEntry({ lastAccessedAt: NOW - 7 * DAY_MS });
    const result = ager.decayWeights([entry], NOW);
    expect(result[0].weight).toBeCloseTo(0.95, 4);
  });

  it("14天未访问——衰减 2 次 (0.95^2 ≈ 0.9025)", () => {
    const ager = new WeightAger(0.95);
    const entry = makeEntry({ lastAccessedAt: NOW - 14 * DAY_MS });
    const result = ager.decayWeights([entry], NOW);
    expect(result[0].weight).toBeCloseTo(0.9025, 4);
  });

  it("35天未访问——连续衰减", () => {
    const ager = new WeightAger(0.95);
    const entry = makeEntry({ lastAccessedAt: NOW - 35 * DAY_MS });
    const result = ager.decayWeights([entry], NOW);
    expect(result[0].weight).toBeLessThan(0.78);
  });

  it("原始条目不被修改", () => {
    const ager = new WeightAger();
    const entry = makeEntry({ lastAccessedAt: NOW - 7 * DAY_MS });
    const beforeWeight = entry.weight;
    ager.decayWeights([entry], NOW);
    expect(entry.weight).toBe(beforeWeight);
  });

  it("衰减幅度 < 0.0001 时不创建新对象（严格判等）", () => {
    const ager = new WeightAger(0.9999);
    const entry = makeEntry({ lastAccessedAt: NOW - 0.1 * DAY_MS });
    const result = ager.decayWeights([entry], NOW);
    // 权重变化极小，应返回原始对象引用
    expect(result[0]).toBe(entry);
  });

  it("空数组——返回空", () => {
    const ager = new WeightAger();
    expect(ager.decayWeights([])).toEqual([]);
  });

  it("自定义 agingFactor", () => {
    const ager = new WeightAger(0.80);
    const entry = makeEntry({ lastAccessedAt: NOW - 7 * DAY_MS });
    const result = ager.decayWeights([entry], NOW);
    expect(result[0].weight).toBeCloseTo(0.80, 4);
  });

  it("多条条目独立衰减", () => {
    const ager = new WeightAger(0.95);
    const entries = [
      makeEntry({ id: "a", lastAccessedAt: NOW }),
      makeEntry({ id: "b", lastAccessedAt: NOW - 7 * DAY_MS }),
      makeEntry({ id: "c", lastAccessedAt: NOW - 14 * DAY_MS }),
    ];
    const result = ager.decayWeights(entries, NOW);
    expect(result[0].weight).toBeCloseTo(1.0, 4);
    expect(result[1].weight).toBeCloseTo(0.95, 4);
    expect(result[2].weight).toBeCloseTo(0.9025, 4);
  });
});

describe("WeightAger.freezeStale", () => {
  it("Active 但过期 + 低权重 → 可归档", () => {
    const ager = new WeightAger(0.95, 30, 7, 0.05);
    const entry = makeEntry({
      semantic_state: "Active",
      lastAccessedAt: NOW - 31 * DAY_MS,
      weight: 0.03,
    });
    const candidates = ager.freezeStale([entry], NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("mem-001");
  });

  it("权重 >= threshold → 不归档", () => {
    const ager = new WeightAger(0.95, 30, 7, 0.05);
    const entry = makeEntry({
      semantic_state: "Active",
      lastAccessedAt: NOW - 31 * DAY_MS,
      weight: 0.10,
    });
    expect(ager.freezeStale([entry], NOW)).toHaveLength(0);
  });

  it("最近访问 → 不归档", () => {
    const ager = new WeightAger(0.95, 30, 7, 0.05);
    const entry = makeEntry({
      semantic_state: "Active",
      lastAccessedAt: NOW - 1 * DAY_MS,
      weight: 0.01,
    });
    expect(ager.freezeStale([entry], NOW)).toHaveLength(0);
  });

  it("Archived 状态 → 不参与 freeze", () => {
    const ager = new WeightAger();
    const entry = makeEntry({
      semantic_state: "Archived",
      lastAccessedAt: NOW - 60 * DAY_MS,
      weight: 0.01,
    });
    expect(ager.freezeStale([entry], NOW)).toHaveLength(0);
  });

  it("空数组 → 空", () => {
    const ager = new WeightAger();
    expect(ager.freezeStale([])).toEqual([]);
  });

  it("自定义 freezeDays", () => {
    const ager = new WeightAger(0.95, 15, 7, 0.05);
    const entry = makeEntry({
      semantic_state: "Active",
      lastAccessedAt: NOW - 20 * DAY_MS,
      weight: 0.02,
    });
    expect(ager.freezeStale([entry], NOW)).toHaveLength(1);
  });
});

describe("WeightAger.obliterateFrozen", () => {
  it("Archived + 长期未访问 → 可湮灭", () => {
    const ager = new WeightAger(0.95, 30, 7);
    const entry = makeEntry({
      semantic_state: "Archived",
      lastAccessedAt: NOW - 8 * DAY_MS,
    });
    const candidates = ager.obliterateFrozen([entry], NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("mem-001");
  });

  it("Active 状态 → 不参与湮灭", () => {
    const ager = new WeightAger(0.95, 30, 7);
    const entry = makeEntry({
      semantic_state: "Active",
      lastAccessedAt: NOW - 60 * DAY_MS,
    });
    expect(ager.obliterateFrozen([entry], NOW)).toHaveLength(0);
  });

  it("最近访问的 Archived → 不湮灭", () => {
    const ager = new WeightAger(0.95, 30, 7);
    const entry = makeEntry({
      semantic_state: "Archived",
      lastAccessedAt: NOW - 1 * DAY_MS,
      expires_at: 0,
    });
    expect(ager.obliterateFrozen([entry], NOW)).toHaveLength(0);
  });

  it("有 expires_at > 0 → 按 expires_at 判断可湮灭", () => {
    const ager = new WeightAger(0.95, 30, 7);
    const entry = makeEntry({
      semantic_state: "Archived",
      lastAccessedAt: NOW,
      expires_at: NOW - 1 * DAY_MS,
    });
    expect(ager.obliterateFrozen([entry], NOW)).toHaveLength(1);
  });

  it("空数组 → 空", () => {
    const ager = new WeightAger();
    expect(ager.obliterateFrozen([])).toEqual([]);
  });

  it("自定义 obliterateDays", () => {
    const ager = new WeightAger(0.95, 30, 14);
    const entry = makeEntry({
      semantic_state: "Archived",
      lastAccessedAt: NOW - 8 * DAY_MS,
    });
    // 8 天 < 14 天，不湮灭
    expect(ager.obliterateFrozen([entry], NOW)).toHaveLength(0);
  });

  it("多个 Archived 条目——独立判断", () => {
    const ager = new WeightAger(0.95, 30, 7);
    const entries = [
      makeEntry({ id: "a", semantic_state: "Archived", lastAccessedAt: NOW - 10 * DAY_MS }),
      makeEntry({ id: "b", semantic_state: "Archived", lastAccessedAt: NOW - 1 * DAY_MS }),
      makeEntry({ id: "c", semantic_state: "Active", lastAccessedAt: NOW - 10 * DAY_MS }),
    ];
    const result = ager.obliterateFrozen(entries, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });
});
