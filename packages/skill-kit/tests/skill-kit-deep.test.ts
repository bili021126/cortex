import { describe, it, expect, beforeEach } from "vitest";
import { SkillRegistry, deriveStatus } from "@cortex/skill-kit";
import type { SkillTemplate } from "@cortex/shared";

function makeSkill(overrides: Partial<SkillTemplate> & { id: string }): SkillTemplate {
  return {
    kind: "action" as any,
    name: overrides.name ?? "default",
    triggerTags: overrides.triggerTags ?? ["fix"],
    trigger: "When fixing",
    steps: overrides.steps ?? ["step 1"],
    expectedOutput: "Fixed",
    status: overrides.status ?? "trial",
    weight: overrides.weight ?? 0,
    feedbackHistory: overrides.feedbackHistory ?? [],
    discoveredBy: "test",
    createdAt: overrides.createdAt ?? Date.now(),
    ...overrides,
  };
}

describe("skill-kit deep", () => {
  let registry: SkillRegistry;
  beforeEach(() => { registry = new SkillRegistry(); });

  it("结晶状态转换: trial→active 正向反馈触发", () => {
    const status = deriveStatus(5, [{ agentId: "a", rating: 1, timestamp: 0 }]);
    expect(status).toBe("active");
  });

  it("结晶状态转换: active→deprecated 连续负向反馈", () => {
    const status = deriveStatus(5, [
      { agentId: "a", rating: -1, timestamp: 0 },
      { agentId: "a", rating: -1, timestamp: 1 },
      { agentId: "a", rating: -1, timestamp: 2 },
    ]);
    expect(status).toBe("deprecated");
  });

  it("结晶状态转换: queryByTags 分页支持", () => {
    for (let i = 0; i < 10; i++) {
      registry.register(makeSkill({ id: `s${i}`, triggerTags: ["fix"], weight: i }));
    }
    const all = registry.queryByTags(["fix"]);
    expect(all.length).toBe(10);
    const page1 = registry.queryByTags(["fix"], { limit: 3, offset: 0 });
    expect(page1.length).toBe(3);
    expect(page1[0]!.weight).toBe(9); // 权重最高
    const page2 = registry.queryByTags(["fix"], { limit: 3, offset: 3 });
    expect(page2.length).toBe(3);
    expect(page2[0]!.weight).toBe(6);
  });

  it("结晶状态转换: cleanupOrphans 清理孤立技能", () => {
    const old = makeSkill({ id: "orphan", weight: 0, createdAt: Date.now() - 10 * 24 * 60 * 60 * 1000 });
    registry.register(old);
    const cleaned = registry.cleanupOrphans(7 * 24 * 60 * 60 * 1000);
    expect(cleaned).toContain("orphan");
  });
});
