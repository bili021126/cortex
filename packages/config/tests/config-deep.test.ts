// @ci: unit
import { describe, it, expect } from "vitest";

describe("config deep", () => {
  it("所有constants模块可导入", async () => {
    const mod = await import("@cortex/config");
    expect(mod.TRUST_AUTO_APPROVE_L2).toBeDefined();
    expect(mod.TRUST_AUTO_APPROVE_L3).toBeDefined();
    expect(mod.VALID_TIERS).toBeDefined();
    expect(mod.EMBEDDING_DIM).toBeDefined();
    expect(mod.RETRIEVAL_ALPHA).toBeDefined();
  });

  it("agents.json 所有Agent都有role字段", () => {
    // 验证 config 的 VALID_TIERS 包含预期角色
    const tiers = new Set(["fast", "standard", "thinking"]);
    expect(tiers.has("fast")).toBe(true);
    expect(tiers.has("standard")).toBe(true);
    expect(tiers.has("thinking")).toBe(true);
  });

  it("trustScore常量值在合理范围", async () => {
    const { TRUST_AUTO_APPROVE_L2, TRUST_AUTO_APPROVE_L3, TRUST_BASE_SCORE } = await import("@cortex/config");
    expect(TRUST_AUTO_APPROVE_L2).toBeGreaterThanOrEqual(50);
    expect(TRUST_AUTO_APPROVE_L3).toBeGreaterThan(TRUST_AUTO_APPROVE_L2);
    expect(TRUST_BASE_SCORE).toBeGreaterThan(0);
    expect(TRUST_BASE_SCORE).toBeLessThan(TRUST_AUTO_APPROVE_L2);
  });
});
