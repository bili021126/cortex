// @ci: unit

import { describe, it, expect } from "vitest";

/**
 * @cortex/skill-kit 当前为薄包装层，核心逻辑已迁移至 @cortex/engine。
 * 本测试仅验证重导出链路完整，防止包升级后导入断裂。
 */
describe("skill-kit 重导出完整性", { timeout: 30000 }, () => {
  it("SkillTemplateEngine 可用", async () => {
    const { SkillTemplateEngine } = await import("@cortex/skill-kit");
    expect(SkillTemplateEngine).toBeDefined();
    expect(typeof SkillTemplateEngine).toBe("function");
  });

  it("validateExternalSkillJson 可用", async () => {
    const { validateExternalSkillJson } = await import("@cortex/skill-kit");
    expect(validateExternalSkillJson).toBeDefined();
    expect(typeof validateExternalSkillJson).toBe("function");
  });

  it("externalJsonToSkillTemplate 可用", async () => {
    const { externalJsonToSkillTemplate } = await import("@cortex/skill-kit");
    expect(externalJsonToSkillTemplate).toBeDefined();
    expect(typeof externalJsonToSkillTemplate).toBe("function");
  });

  it("importExternalSkill 可用", async () => {
    const { importExternalSkill } = await import("@cortex/skill-kit");
    expect(importExternalSkill).toBeDefined();
    expect(typeof importExternalSkill).toBe("function");
  });

  it("类型导出可用", async () => {
    // 类型在运行时不可直接验证，但 import 不抛异常即表示导出链路完好
    const mod = await import("@cortex/skill-kit");
    expect(mod).toBeDefined();
  });
});
