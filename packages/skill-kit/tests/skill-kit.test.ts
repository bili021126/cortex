// @ci: unit
import { describe, it, expect } from "vitest";

describe("@cortex/skill-kit smoke", () => {
  it("barrel export 可导入", async () => {
    const mod = await import("@cortex/skill-kit");
    expect(mod).toBeDefined();
  });

  it("SkillRegistry 可导入", async () => {
    const { SkillRegistry } = await import("@cortex/skill-kit");
    expect(SkillRegistry).toBeDefined();
  });

  it("deriveStatus 可导入", async () => {
    const { deriveStatus } = await import("@cortex/skill-kit");
    expect(deriveStatus).toBeDefined();
  });
});
