// @ci: unit

import { describe, it, expect } from "vitest";
import {
  evaluateAmendment,
  checkTimeout,
  updateStaleCount,
  getRegisteredStages,
  validateConstitutionAmendment,
} from "@cortex/governance";
import type { AmendmentProposal } from "@cortex/shared";

describe("@cortex/governance — 导出完整性", () => {
  it("evaluateAmendment 为可调用函数", () => {
    expect(typeof evaluateAmendment).toBe("function");
  });

  it("checkTimeout 为可调用函数", () => {
    expect(typeof checkTimeout).toBe("function");
  });

  it("updateStaleCount 为可调用函数", () => {
    expect(typeof updateStaleCount).toBe("function");
  });

  it("getRegisteredStages 返回数组", () => {
    const stages = getRegisteredStages();
    expect(Array.isArray(stages)).toBe(true);
  });

  // ── G-02: 硬编码检测正则修复 ──

  it("硬编码检测正则匹配冒号+5位以上数字（G-02 修复）", () => {
    const proposal: AmendmentProposal = {
      id: "test-1",
      section: "test",
      before: "old",
      after: "port: 12345",
      rationale: "test",
      status: "pending_judgment",
    };
    const result = validateConstitutionAmendment(proposal);
    const hc = result.verdicts.find((v) => v.id === 8);
    expect(hc?.passed).toBe(false);
    expect(hc?.reason).toContain("硬编码");
  });

  it("硬编码检测正则不匹配冒号后接单词（G-02 修复）", () => {
    const proposal: AmendmentProposal = {
      id: "test-2",
      section: "test",
      before: "old",
      after: "word: sad bee",
      rationale: "test",
      status: "pending_judgment",
    };
    const result = validateConstitutionAmendment(proposal);
    const hc = result.verdicts.find((v) => v.id === 8);
    expect(hc?.passed).toBe(true);
  });
});
