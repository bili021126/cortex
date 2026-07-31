// @ci: unit
import { describe, it, expect } from "vitest";
import { SkillTemplateEngine } from "@cortex/skill-kit";

describe("Skill template engine — prototype safety", () => {
  const engine = new SkillTemplateEngine();

  it("变量路径禁止访问 __proto__", () => {
    const ctx = { safe: "ok", polluted: "secret" };
    // 渲染含 __proto__ 路径的模板，应返回 undefinedPlaceholder（""），绝不解析出原型内容
    const out = engine.render("{{ __proto__.polluted }}", ctx);
    expect(out).toBe("");
  });

  it("变量路径禁止访问 constructor", () => {
    const ctx = { safe: "ok" };
    const out = engine.render("{{ constructor }}", ctx);
    expect(out).toBe("");
    // 嵌套路径同样被拦截
    expect(engine.render("{{ deep.constructor.name }}", ctx)).toBe("");
  });

  it("正常变量路径正常解析", () => {
    const ctx = { deep: { key: "value" } };
    const out = engine.render("{{ deep.key }}", ctx);
    expect(out).toBe("value");
  });
});
