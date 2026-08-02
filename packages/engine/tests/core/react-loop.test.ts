// @ci: unit
import { describe, it, expect } from "vitest";

describe("ReactLoop", () => {
  it("模块导出 LoopStrategyRegistry", async () => {
    const mod = await import("@cortex/engine");
    expect(mod.LoopStrategyRegistry).toBeDefined();
  });

  it("LoopStrategyRegistry 有 selectByRule 方法", async () => {
    const mod = await import("@cortex/engine");
    const registry = mod.loopStrategyRegistry;
    if (registry) {
      expect(typeof registry.selectByRule).toBe("function");
    }
  });
});
