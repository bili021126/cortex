// @ci: unit
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillRegistry, AgentType } from "@cortex/shared";
import type { Tag } from "@cortex/shared";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

function makeSkill(overrides: Partial<{
  id: string; agentType: AgentType; triggerTags: Tag[]; status: string; name: string;
}> = {}) {
  return {
    id: overrides.id ?? "skill-1",
    agentType: overrides.agentType ?? AgentType.Code,
    name: overrides.name ?? "测试技能模板",
    triggerTags: (overrides.triggerTags ?? ["implementation", "bugfix"]) as Tag[],
    trigger: "当需要实现或修复代码时触发",
    steps: ["读取相关文件", "分析代码结构", "实施修改"],
    expectedOutput: "修改后的代码文件",
    outputFile: "output.md",
    status: (overrides.status ?? "active") as "draft" | "trial" | "active" | "deprecated",
    adoptionCount: 0,
    rejectionCount: 0,
    discoveredBy: "LoopAgent",
    createdAt: Date.now(),
  };
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
    registry.register(makeSkill({ id: "s1", status: "active" }));
    registry.register(makeSkill({ id: "s2", status: "deprecated" }));
    registry.register(makeSkill({ id: "s3", status: "draft" }));

    const matches = registry.queryByTags(["implementation"]);
    expect(matches.length).toBe(1); // only "active"
    expect(matches[0].id).toBe("s1");
  });

  it("should include trial status in queries", () => {
    registry.register(makeSkill({ id: "s1", status: "trial" }));
    const matches = registry.queryByTags(["implementation"]);
    expect(matches.length).toBe(1);
  });

  it("should query by agent type", () => {
    registry.register(makeSkill({ id: "s1", agentType: AgentType.Code }));
    registry.register(makeSkill({ id: "s2", agentType: AgentType.Review }));
    registry.register(makeSkill({ id: "s3", agentType: AgentType.Code }));

    const matches = registry.queryByAgent(AgentType.Code);
    expect(matches.length).toBe(2);
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
    registry.register(makeSkill({ id: "s1", status: "active" }));
    registry.register(makeSkill({ id: "s2", status: "deprecated" }));
    registry.register(makeSkill({ id: "s3", status: "active" }));

    expect(registry.totalCount).toBe(3);
    expect(registry.activeCount).toBe(2);
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
      registry.register(makeSkill({ id: "s2", name: "Quick Fix", agentType: AgentType.Fix }));

      const json = registry.toJSON();
      expect(json.version).toBe(1);
      expect(json.templates.length).toBe(2);

      const restored = SkillRegistry.fromJSON(json);
      expect(restored.totalCount).toBe(2);
      expect(restored.get("s1")?.name).toBe("Pattern Scan");
      expect(restored.get("s2")?.agentType).toBe(AgentType.Fix);
    });

    it("should save and load via JSON file", () => {
      registry.register(makeSkill({ id: "s1", name: "Saved Skill" }));
      registry.register(makeSkill({ id: "s2", name: "Second Skill" }));

      const filePath = path.join(tmpDir, "skills.json");
      registry.saveJson(filePath);

      expect(fs.existsSync(filePath)).toBe(true);

      const loaded = SkillRegistry.loadJson(filePath);
      expect(loaded.totalCount).toBe(2);
      expect(loaded.get("s1")?.name).toBe("Saved Skill");
      expect(loaded.queryByTags(["implementation"]).length).toBe(2);
    });

    it("should create directory when saving if not exists", () => {
      registry.register(makeSkill({ id: "s1" }));
      const filePath = path.join(tmpDir, "nested", "dir", "skills.json");

      expect(() => registry.saveJson(filePath)).not.toThrow();
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("should return empty registry when loading nonexistent file", () => {
      const filePath = path.join(tmpDir, "nonexistent.json");
      const loaded = SkillRegistry.loadJson(filePath);
      expect(loaded.totalCount).toBe(0);
    });

    it("should preserve index consistency after round-trip", () => {
      registry.register(makeSkill({ id: "s1", agentType: AgentType.Code, triggerTags: ["implementation"] }));
      registry.register(makeSkill({ id: "s2", agentType: AgentType.Review, triggerTags: ["review"] }));
      registry.register(makeSkill({ id: "s3", agentType: AgentType.Code, triggerTags: ["refactor"] }));

      const filePath = path.join(tmpDir, "skills.json");
      registry.saveJson(filePath);

      const loaded = SkillRegistry.loadJson(filePath);
      expect(loaded.queryByTags(["implementation"]).length).toBe(1);
      expect(loaded.queryByTags(["review"]).length).toBe(1);
      expect(loaded.queryByAgent(AgentType.Code).length).toBe(2);
      expect(loaded.queryByAgent(AgentType.Review).length).toBe(1);
    });
  });
});
