// @ci: removed — skill-kit 核心逻辑已迁移至 @cortex/engine（TUI 深化 v2.6.4）
// ============================================================
// @cortex/skill-kit — SimpleSkillValidator 单元测试
// ============================================================

import { describe, it, expect } from "vitest";
import {
  type SkillDefinition,
  type SkillMeta,
  type SkillManifest,
  SkillCategory,
  SkillErrorCode,
} from "../dist/types.js";
import { SimpleSkillValidator } from "../dist/validator.js";

// ── 辅助函数 ──────────────────────────────────────────────────

function makeValidMeta(overrides?: Partial<SkillMeta>): SkillMeta {
  return {
    id: "test-skill",
    name: "测试技能",
    version: "1.0.0",
    description: "一个测试技能",
    category: SkillCategory.TOOL,
    triggerTags: ["test"],
    trigger: "测试触发",
    steps: ["步骤1", "步骤2"],
    expectedOutput: "测试输出",
    ...overrides,
  };
}

function makeValidSkill(metaOverrides?: Partial<SkillMeta>): SkillDefinition {
  return {
    meta: makeValidMeta(metaOverrides),
    async execute() {
      return { success: true, data: "ok" };
    },
  };
}

// ── 测试 ──────────────────────────────────────────────────────

describe("SimpleSkillValidator.validate", () => {
  const validator = new SimpleSkillValidator();

  it("通过有效的技能定义", () => {
    const result = validator.validate(makeValidSkill());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("拒绝缺少 execute 的技能", () => {
    const skill = makeValidSkill() as SkillDefinition;
    // biome-ignore lint: 测试需要强制移除 execute 方法
    (skill as any).execute = undefined;
    const result = validator.validate(skill);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "execute")).toBe(true);
  });

  it("拒绝缺少 id 的技能", () => {
    const skill = makeValidSkill({ id: "" as string });
    const result = validator.validate(skill);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "meta.id")).toBe(true);
  });

  it("拒绝无效 version 格式（严格模式）", () => {
    const skill = makeValidSkill({ version: "invalid" });
    const result = validator.validate(skill);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "meta.version")).toBe(true);
  });

  it("接受非严格版本校验", () => {
    const relaxed = new SimpleSkillValidator({ strictVersion: false });
    const skill = makeValidSkill({ version: "latest" });
    const result = relaxed.validate(skill);
    expect(result.valid).toBe(true);
  });

  it("拒绝空的 steps", () => {
    const skill = makeValidSkill({ steps: [] });
    const result = validator.validate(skill);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "meta.steps")).toBe(true);
  });

  it("拒绝自引用 dependencies", () => {
    const skill = makeValidSkill({
      dependencies: ["test-skill"],
    });
    const result = validator.validate(skill);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "meta.dependencies")).toBe(true);
  });

  it("校验 validateInput 类型错误", () => {
    const skill = makeValidSkill() as SkillDefinition;
    // biome-ignore lint: 测试需要将 validateInput 设为非函数类型
    (skill as any).validateInput = "not-a-function";
    const result = validator.validate(skill);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "validateInput")).toBe(true);
  });
});

describe("SimpleSkillValidator.validateMeta", () => {
  const validator = new SimpleSkillValidator();

  it("通过有效的 meta", () => {
    const result = validator.validateMeta(makeValidMeta());
    expect(result.valid).toBe(true);
  });

  it("拒绝 null meta", () => {
    const result = validator.validateMeta(null as unknown as SkillMeta);
    expect(result.valid).toBe(false);
  });

  it("警告空的 triggerTags", () => {
    const result = validator.validateMeta(makeValidMeta({ triggerTags: [] }));
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("SimpleSkillValidator.validateManifest", () => {
  const validator = new SimpleSkillValidator();

  it("通过有效的 manifest", () => {
    const manifest: SkillManifest = {
      id: "test-json",
      agentType: "code",
      name: "JSON 技能",
      triggerTags: ["test"],
      trigger: "测试",
      steps: ["步骤1"],
      expectedOutput: "输出",
    };
    const result = validator.validateManifest(manifest);
    expect(result.valid).toBe(true);
  });

  it("拒绝缺少 agentType 的 manifest", () => {
    const manifest: SkillManifest = {
      id: "test-json",
      agentType: "",
      name: "JSON 技能",
      triggerTags: ["test"],
      trigger: "测试",
      steps: ["步骤1"],
      expectedOutput: "输出",
    };
    const result = validator.validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "agentType")).toBe(true);
  });

  it("拒绝 null manifest", () => {
    const result = validator.validateManifest(null as unknown as SkillManifest);
    expect(result.valid).toBe(false);
  });
});
