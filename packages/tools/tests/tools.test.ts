import { describe, it, expect } from "vitest";

describe("@cortex/tools smoke", () => {
  it("barrel export 可导入", async () => {
    const mod = await import("@cortex/tools");
    expect(mod).toBeDefined();
  });

  it("detectDrifts 可导入", async () => {
    const { detectDrifts } = await import("@cortex/tools");
    expect(detectDrifts).toBeDefined();
  });

  it("findProjectRoot 可导入", async () => {
    const { findProjectRoot } = await import("@cortex/tools");
    expect(findProjectRoot).toBeDefined();
  });

  it("detectCycles 可导入", async () => {
    const { detectCycles } = await import("@cortex/tools");
    expect(detectCycles).toBeDefined();
  });
});
