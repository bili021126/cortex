// @ci: unit
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillRegistry } from "@cortex/skill-kit";
import type { SkillKind, Tag, FeedbackEntry } from "@cortex/shared";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

function makeSkill(overrides: Partial<{
  id: string; kind: SkillKind; triggerTags: Tag[]; status: string; name: string;
  weight: number; feedbackHistory: FeedbackEntry[];
}> = {}) {
  return {
    id: overrides.id ?? "skill-1",
    kind: overrides.kind ?? "action",
    name: overrides.name ?? "测试技能模板",
    triggerTags: (overrides.triggerTags ?? ["implementation", "bugfix"]) as Tag[],
    trigger: "当需要实现或修复代码时触发",
    steps: ["读取相关文件", "分析代码结构", "实施修改"],
    expectedOutput: "修改后的代码文件",
    outputFile: "output.md",
    status: (overrides.status ?? "active") as "trial" | "active" | "deprecated",
    weight: overrides.weight ?? 0,
    feedbackHistory: overrides.feedbackHistory ?? [],
    discoveredBy: "LoopAgent",
    createdAt: Date.now()};
}

describe("SkillRegistry", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  it("should register and retrieve by id", () => {
    const skill = makeSkill();
    registry.register(skill);
    expect(registry.get("skill-1")).toEqual(skill);
  });

  it("should query by tags", () => {
    registry.register(makeSkill({ id: "s1", triggerTags: ["implementation"] }));
    registry.register(makeSkill({ id: "s2", triggerTags: ["bugfix"] }));
    registry.register(makeSkill({ id: "s3", triggerTags: ["refactor"] }));

    const matches = registry.queryByTags(["implementation"]);
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe("s1");
  });

  it("should query by multiple tags (union)", () => {
    registry.register(makeSkill({ id: "s1", triggerTags: ["implementation"] }));
    registry.register(makeSkill({ id: "s2", triggerTags: ["bugfix"] }));
    registry.register(makeSkill({ id: "s3", triggerTags: ["refactor"] }));

    const matches = registry.queryByTags(["implementation", "bugfix"]);
    expect(matches.length).toBe(2);
  });

  it("should filter out inactive status", () => {
    // status 由 deriveStatus(weight, feedbackHistory) 动态推导
    registry.register(makeSkill({ id: "s1", status: "active", weight: 5, feedbackHistory: [{ agentId: "x", rating: 1, timestamp: Date.now() }] }));
    registry.register(makeSkill({ id: "s2", status: "deprecated", weight: -3, feedbackHistory: [
      { agentId: "x", rating: -1, timestamp: Date.now() - 3000 },
      { agentId: "x", rating: -1, timestamp: Date.now() - 2000 },
      { agentId: "x", rating: -1, timestamp: Date.now() - 1000 },
    ]}));
    registry.register(makeSkill({ id: "s3", status: "trial", weight: 0, feedbackHistory: [] }));

    const matches = registry.queryByTags(["implementation"]);
    expect(matches.length).toBe(2); // active + trial
    expect(matches.map((m) => m.id).sort()).toEqual(["s1", "s3"]);
  });

  it("should include trial status in queries", () => {
    registry.register(makeSkill({ id: "s1", status: "trial", weight: 0, feedbackHistory: [] }));
    const matches = registry.queryByTags(["implementation"]);
    expect(matches.length).toBe(1);
  });

  it("should query by kind via getAll filter", () => {
    // queryByAgent 已移除；按 kind 过滤改用 getAll() + filter
    registry.register(makeSkill({ id: "s1", kind: "action", triggerTags: ["fix"] }));
    registry.register(makeSkill({ id: "s2", kind: "thought", triggerTags: ["review"] }));
    registry.register(makeSkill({ id: "s3", kind: "action", triggerTags: ["refactor"] }));

    const actionSkills = registry.getAll().filter((s) => s.kind === "action");
    expect(actionSkills.length).toBe(2);
  });

  it("should unregister a skill", () => {
    registry.register(makeSkill({ id: "s1" }));
    expect(registry.get("s1")).toBeDefined();

    const ok = registry.unregister("s1");
    expect(ok).toBe(true);
    expect(registry.get("s1")).toBeUndefined();
  });

  it("should return false when unregistering unknown id", () => {
    const ok = registry.unregister("nonexistent");
    expect(ok).toBe(false);
  });

  it("should deduplicate by id on register", () => {
    const s1 = makeSkill({ id: "s1", name: "First" });
    const s2 = makeSkill({ id: "s1", name: "Second" });
    registry.register(s1);
    registry.register(s2);
    expect(registry.get("s1")?.name).toBe("Second");
    expect(registry.totalCount).toBe(1);
  });

  it("should track active and total counts", () => {
    // activeCount 由 deriveStatus 动态推导
    registry.register(makeSkill({ id: "s1", status: "active", weight: 5, feedbackHistory: [{ agentId: "x", rating: 1, timestamp: Date.now() }] }));
    registry.register(makeSkill({ id: "s2", status: "deprecated", weight: -3, feedbackHistory: [
      { agentId: "x", rating: -1, timestamp: Date.now() - 3000 },
      { agentId: "x", rating: -1, timestamp: Date.now() - 2000 },
      { agentId: "x", rating: -1, timestamp: Date.now() - 1000 },
    ]}));
    registry.register(makeSkill({ id: "s3", status: "active", weight: 3, feedbackHistory: [{ agentId: "x", rating: 1, timestamp: Date.now() }] }));

    expect(registry.totalCount).toBe(3);
    expect(registry.activeCount).toBe(2); // s1 + s3
  });

  it("should clear all skills", () => {
    registry.register(makeSkill({ id: "s1" }));
    registry.register(makeSkill({ id: "s2" }));
    registry.clear();
    expect(registry.totalCount).toBe(0);
  });

  it("should return empty array for unmatched tags", () => {
    registry.register(makeSkill({ id: "s1", triggerTags: ["implementation"] }));
    const matches = registry.queryByTags(["unknown_tag" as Tag]);
    expect(matches.length).toBe(0);
  });

  it("should registerAll to bulk register skills", () => {
    const skills = [
      makeSkill({ id: "s1", name: "Skill One" }),
      makeSkill({ id: "s2", name: "Skill Two" }),
    ];
    registry.registerAll(skills);
    expect(registry.totalCount).toBe(2);
    expect(registry.get("s1")?.name).toBe("Skill One");
  });

  // ── 持久化测试 ──────────────────────────────
  describe("persistence", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-test-"));
    });

    afterEach(() => {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("should round-trip via toJSON/fromJSON", () => {
      registry.register(makeSkill({ id: "s1", name: "Pattern Scan" }));
      registry.register(makeSkill({ id: "s2", name: "Quick Fix", kind: "action" }));

      const json = registry.toJSON();
      expect(json.version).toBe(2); // v2.6 版本号
      expect(json.templates.length).toBe(2);

      const restored = SkillRegistry.fromJSON(json);
      expect(restored.totalCount).toBe(2);
      expect(restored.get("s1")?.name).toBe("Pattern Scan");
      expect(restored.get("s2")?.kind).toBe("action");
    });

    it("should round-trip via toJSON/fromJSON", () => {
      registry.register(makeSkill({ id: "s1", name: "Saved Skill" }));
      registry.register(makeSkill({ id: "s2", name: "Second Skill" }));

      const json = registry.toJSON();
      const loaded = SkillRegistry.fromJSON(json);
      expect(loaded.totalCount).toBe(2);
      expect(loaded.get("s1")?.name).toBe("Saved Skill");
    });

    it("should return empty registry from empty JSON", () => {
      const loaded = SkillRegistry.fromJSON({ version: 1, templates: [] });
      expect(loaded.totalCount).toBe(0);
    });

    it("should preserve index consistency after round-trip", () => {
      registry.register(makeSkill({ id: "s1", kind: "action", triggerTags: ["implementation"] }));
      registry.register(makeSkill({ id: "s2", kind: "thought", triggerTags: ["review"] }));
      registry.register(makeSkill({ id: "s3", kind: "action", triggerTags: ["refactor"] }));

      const json = registry.toJSON();
      const loaded = SkillRegistry.fromJSON(json);
      expect(loaded.queryByTags(["implementation"]).length).toBe(1);
      expect(loaded.queryByTags(["review"]).length).toBe(1);
      // queryByAgent 已移除，改用 getAll + filter
      expect(loaded.getAll().filter((s) => s.kind === "action").length).toBe(2);
      expect(loaded.getAll().filter((s) => s.kind === "thought").length).toBe(1);
    });
  });
});
