// ⚠️ 此测试已停用：核心逻辑已迁移至 @cortex/engine（TUI 深化 v2.6.4）
// ============================================================
// @cortex/skill-kit — 核心类型 单元测试
// ============================================================

import { describe, it, expect } from "vitest";
import {
  SkillCategory,
  SkillErrorCode,
} from "../dist/types.js";

describe("SkillCategory 枚举", () => {
  it("包含所有预期分类", () => {
    const categories = Object.values(SkillCategory);
    expect(categories).toContain("data");
    expect(categories).toContain("nlp");
    expect(categories).toContain("tool");
    expect(categories).toContain("reasoning");
    expect(categories).toContain("memory");
    expect(categories).toContain("communication");
    expect(categories).toContain("system");
  });

  it("枚举数量为 7", () => {
    expect(Object.keys(SkillCategory).length).toBe(7);
  });
});

describe("SkillErrorCode 枚举", () => {
  it("包含所有预期错误码", () => {
    expect(SkillErrorCode.NOT_FOUND).toBe("SKILL_NOT_FOUND");
    expect(SkillErrorCode.LOAD_FAILED).toBe("SKILL_LOAD_FAILED");
    expect(SkillErrorCode.VALIDATION_FAILED).toBe("SKILL_VALIDATION_FAILED");
    expect(SkillErrorCode.EXECUTION_FAILED).toBe("SKILL_EXECUTION_FAILED");
    expect(SkillErrorCode.TIMEOUT).toBe("SKILL_TIMEOUT");
    expect(SkillErrorCode.ABORTED).toBe("SKILL_ABORTED");
    expect(SkillErrorCode.INIT_FAILED).toBe("SKILL_INIT_FAILED");
    expect(SkillErrorCode.INTERNAL_ERROR).toBe("SKILL_INTERNAL_ERROR");
  });
});
