// @ci: unit
import { describe, it, expect } from "vitest";
import { WorldbookEngine } from "@cortex/memory";

describe("L0/L1/L2 接口", () => {
  it("WorldbookEngine 可实例化", () => {
    const wb = new WorldbookEngine();
    expect(wb).toBeDefined();
    expect(wb.getActiveEntries().length).toBe(0);
  });
});
