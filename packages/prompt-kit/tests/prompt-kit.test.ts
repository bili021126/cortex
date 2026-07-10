// @ci: unit
import { describe, it, expect } from "vitest";

describe("@cortex/prompt-kit smoke", () => {
  it("barrel export 可导入", async () => {
    const mod = await import("@cortex/prompt-kit");
    expect(mod).toBeDefined();
  });

  it("PromptOrchestrator 可导入", async () => {
    const { PromptOrchestrator } = await import("@cortex/prompt-kit");
    expect(PromptOrchestrator).toBeDefined();
  });

  it("PromptLoader 可导入", async () => {
    const { PromptLoader } = await import("@cortex/prompt-kit");
    expect(PromptLoader).toBeDefined();
  });

  it("PromptTemplate 类型可导入", async () => {
    // PromptTemplate 是 type，运行时值为 undefined 但导入不抛异常即可
    const mod = await import("@cortex/prompt-kit");
    expect(mod).toBeDefined();
  });
});
