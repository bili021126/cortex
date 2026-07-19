// @ci: unit
import { describe, it, expect } from "vitest";

describe("prompt-kit deep", () => {
  it("模板渲染: PromptTemplateEngine 渲染变量", async () => {
    const { PromptTemplateEngine } = await import("@cortex/prompt-kit");
    const engine = new PromptTemplateEngine();
    const result = engine.render("Hello {{name}}!", { variables: { name: "World" } });
    expect(result).toBe("Hello World!");
  });

  it("模板渲染: 缺失变量静默忽略", async () => {
    const { PromptTemplateEngine } = await import("@cortex/prompt-kit");
    const engine = new PromptTemplateEngine();
    const result = engine.render("{{a}} {{b}}", { variables: { a: "hello" } });
    expect(result).toBe("hello ");
  });

  it("模板渲染: PromptLoader 可加载内联源", async () => {
    const { PromptLoader, InlinePromptSource, PromptBlockType } = await import("@cortex/prompt-kit");
    const loader = new PromptLoader();
    const source = new InlinePromptSource();
    source.register("test", "test prompt", PromptBlockType.Instruction, 50);
    loader.registerSource("inline-test", source);
    const template = await loader.load("test");
    expect(template).toBeDefined();
  });
});
