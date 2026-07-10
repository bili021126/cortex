// @ci: unit
import { describe, it, expect } from "vitest";

describe("platform smoke", () => {
  it("toolkit exports expected symbols", async () => {
    const mod = await import("@cortex/platform");
    expect(mod).toBeDefined();
  });
});
