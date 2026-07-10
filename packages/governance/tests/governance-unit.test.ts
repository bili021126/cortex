// @ci: unit
// ============================================================
// @cortex/governance —— ConstitutionValidator 单元测试
// validateConstitutionAmendment 九子约束验证
// ============================================================

import { describe, it, expect } from "vitest";
import { validateConstitutionAmendment } from "@cortex/governance";
import type { AmendmentProposal } from "@cortex/shared";

// ─── 测试夹具 ──────────────────────────────────

function validProposal(overrides: Partial<AmendmentProposal> = {}): AmendmentProposal {
  return {
    id: "AM-2026-0001",
    version: "v2.5.11",
    section: "§5.1",
    category: "modify",
    summary: "[Core] 修订单个条款",
    rationale: "需要修改以适配新架构",
    before: "旧文本内容",
    after: "新文本内容",
    impact: {
      principles: [],
      crossReferences: [],
      agents: [],
      breaking: false,
    },
    source: {
      agent: "DocGovern",
      trace: "audit-001",
    },
    status: "pending_judgment",
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────

describe("ConstitutionValidator", () => {
  it("有效宪法通过", () => {
    const result = validateConstitutionAmendment(validProposal());
    expect(result.passed).toBe(true);
    expect(result.verdicts).toHaveLength(9);
    // 全部通过
    for (const v of result.verdicts) {
      expect(v.passed).toBe(true);
    }
  });

  it("缺失 section 拒绝（检查①显式引用条款）", () => {
    const result = validateConstitutionAmendment(validProposal({ section: "" }));
    expect(result.verdicts[0]!.passed).toBe(false);
    expect(result.verdicts[0]!.reason).toContain("缺少 section");
    expect(result.passed).toBe(false);
  });

  it("缺失 before 拒绝（检查①显式引用条款）", () => {
    const result = validateConstitutionAmendment(validProposal({ before: "" }));
    expect(result.verdicts[0]!.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("缺失 rationale 拒绝（检查②完整记录）", () => {
    const result = validateConstitutionAmendment(validProposal({ rationale: "" }));
    expect(result.verdicts[1]!.passed).toBe(false);
    expect(result.verdicts[1]!.reason).toContain("缺少 before/after/rationale");
    expect(result.passed).toBe(false);
  });

  it("改动幅度过大拒绝（检查③最小改动）", () => {
    const result = validateConstitutionAmendment(validProposal({
      before: "短文本",
      after: "这".repeat(20), // 超过原文 3 倍
    }));
    expect(result.verdicts[2]!.passed).toBe(false);
    expect(result.verdicts[2]!.reason).toContain("改动幅度过大");
    expect(result.passed).toBe(false);
  });

  it("影响核心 Agent 但未标注架构验证拒绝（检查④架构保护）", () => {
    const result = validateConstitutionAmendment(validProposal({
      impact: {
        principles: [],
        crossReferences: [],
        agents: ["scheduler"],
        breaking: false,
      },
    }));
    expect(result.verdicts[3]!.passed).toBe(false);
    expect(result.verdicts[3]!.reason).toContain("架构关键 Agent");
    expect(result.passed).toBe(false);
  });

  it("影响核心 Agent 且标注架构验证通过", () => {
    const result = validateConstitutionAmendment(validProposal({
      impact: {
        principles: ["架构影响: 已验证"],
        crossReferences: [],
        agents: ["meta-agent"],
        breaking: false,
      },
    }));
    expect(result.verdicts[3]!.passed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("非 pending_judgment 状态拒绝（检查⑤独立审计）", () => {
    const result = validateConstitutionAmendment(validProposal({
      status: "draft",
    }));
    expect(result.verdicts[4]!.passed).toBe(false);
    expect(result.verdicts[4]!.reason).toContain("pending_judgment");
    expect(result.passed).toBe(false);
  });

  it("缺失阶段标注拒绝（检查⑥阶段限定）", () => {
    const result = validateConstitutionAmendment(validProposal({
      summary: "修订单个条款", // 不含 [Core]/[Meso]/[Full]
    }));
    expect(result.verdicts[5]!.passed).toBe(false);
    expect(result.verdicts[5]!.reason).toContain("未标注适用阶段");
    expect(result.passed).toBe(false);
  });

  it("修改原则七但未标注 [元规则] 拒绝（检查⑦子约束修改规则）", () => {
    const result = validateConstitutionAmendment(validProposal({
      section: "原则七",
      summary: "[Core] 修改原则七",
    }));
    expect(result.verdicts[6]!.passed).toBe(false);
    expect(result.verdicts[6]!.reason).toContain("[元规则]");
    expect(result.passed).toBe(false);
  });

  it("修改原则七且标注 [元规则] 通过", () => {
    const result = validateConstitutionAmendment(validProposal({
      section: "原则七",
      summary: "[Core] [元规则] 修改原则七",
    }));
    expect(result.verdicts[6]!.passed).toBe(true);
  });

  it("硬编码大数字拒绝（检查⑧硬编码禁令）", () => {
    const result = validateConstitutionAmendment(validProposal({
      after: "timeout: 32000", // 匹配 includes(": 32000")
    }));
    expect(result.verdicts[7]!.passed).toBe(false);
    expect(result.verdicts[7]!.reason).toContain("硬编码");
    expect(result.passed).toBe(false);
  });

  it("涉及类型变更但未标注 [类型已校验] 拒绝（检查⑨类型安全保障）", () => {
    const result = validateConstitutionAmendment(validProposal({
      impact: {
        principles: ["type变更"],
        crossReferences: [],
        agents: [],
        breaking: false,
      },
    }));
    expect(result.verdicts[8]!.passed).toBe(false);
    expect(result.verdicts[8]!.reason).toContain("[类型已校验]");
    expect(result.passed).toBe(false);
  });

  it("涉及类型变更且标注 [类型已校验] 通过", () => {
    const result = validateConstitutionAmendment(validProposal({
      summary: "[Core] [类型已校验] 接口变更",
      impact: {
        principles: ["interface change"],
        crossReferences: [],
        agents: [],
        breaking: false,
      },
    }));
    expect(result.verdicts[8]!.passed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("空提案全部拒绝", () => {
    const result = validateConstitutionAmendment(validProposal({
      section: "原则七",
      before: "",
      after: "",
      rationale: "",
      summary: "",
      status: "draft" as any,
    }));
    expect(result.passed).toBe(false);
    // 至少 5 项失败：①缺失引用 ②缺记录 ③改动幅度 ⑤审计 ⑥阶段 ⑦元规则
    const failedCount = result.verdicts.filter(v => !v.passed).length;
    expect(failedCount).toBeGreaterThanOrEqual(5);
  });
});
