// @ci: unit
import { describe, it, expect } from "vitest";

describe("@cortex/testing smoke", () => {
  it("barrel export 可导入", async () => {
    const mod = await import("@cortex/testing");
    expect(mod).toBeDefined();
  });

  it("syntheticTaskNode 可导入", async () => {
    const { syntheticTaskNode } = await import("@cortex/testing");
    expect(syntheticTaskNode).toBeDefined();
  });

  it("generateSyntheticMemories 可导入", async () => {
    const { generateSyntheticMemories } = await import("@cortex/testing");
    expect(generateSyntheticMemories).toBeDefined();
  });
});
