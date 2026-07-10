// @ci: unit
import { describe, it, expect } from "vitest";

describe("scheduler smoke", () => {
  it("exports expected symbols", async () => {
    const mod = await import("@cortex/scheduler");
    expect(mod).toBeDefined();
  });
  
  it("TopologicalLayeredDriver can be imported", async () => {
    const { TopologicalLayeredDriver } = await import("@cortex/scheduler");
    expect(TopologicalLayeredDriver).toBeDefined();
  });
  
  it("ConfirmGate can be imported", async () => {
    const { ConfirmGate } = await import("@cortex/scheduler");
    expect(ConfirmGate).toBeDefined();
  });
});
