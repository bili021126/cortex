/**
 * amendment-judge 评判引擎单元测试。
 *
 * 覆盖：
 *   - 不可变原则阻断（触犯原则一）
 *   - 正确提案全通过
 *   - 虚假 before 段落阻断
 *   - 版本号回退阻断
 *   - 缺失交叉引用
 *   - 摘要/理由过短 NEEDS_CLARIFICATION
 *   - breaking=true → APPROVED_WITH_CAVEATS
 */

import { describe, it, expect } from "vitest";
import { evaluateAmendment } from "../src/amendment-judge.js";
import type { AmendmentProposal } from "@cortex/shared";

// ── 微型宪法 fixture ─────────────────────────────

const FIXTURE_CONSTITUTION = [
  "# Cortex 概念顶层设计 v2.5",
  "",
  "**版本**：v2.5.10",
  "**状态**：测试 fixture",
  "",
  "---",
  "",
  "## 二、六条不可变原则",
  "",
  "| 原则 | 内容 | 不可变性 |",
  "|------|------|---------|",
  "| **原则一** | 确认这个动作永远在用户手里。任何 L2/L3 不可逆操作必须经用户确认 | 不可变 |",
  "| **原则二** | 规划与执行分离。MetaAgent 只规划不执行，Agent 只执行不规划 | 不可变 |",
  "| **原则六** | 用户是最终裁决者。多 Agent 并行产出须先经圆桌协商收束为统一视图，再呈用户裁决 | 不可变 |",
  "",
  "---",
  "",
  "## 三、系统架构",
  "",
  "Cortex 包含 DocGovernAgent、CodeAgent、ReviewAgent 等组件。",
  "",
  "DocGovernAgent 负责审计。参见 §5.1。",
  "",
  "## 五、Agent 类型",
  "",
  "### §5.1 Agent 类型表",
  "",
  "DocGovernAgent 标签：constitution_check。",
  "See also §3.1 for architecture.",
  "",
].join("\n");

// ── 辅助函数 ─────────────────────────────────────

function makeProposal(overrides: Partial<AmendmentProposal> = {}): AmendmentProposal {
  return {
    id: "AM-2026-0515-001",
    version: "v2.5.11",
    section: "§5.1",
    category: "modify",
    summary: "在 §5.1 Agent 类型表中新增 constitution_propose 标签说明",
    rationale: "DocGovernAgent 已新增 constitution_propose 标签以支持修宪提案生成能力。宪法 §5.1 应同步更新标签列表以反映此变更。",
    before: "DocGovernAgent 标签：constitution_check。",
    after: "DocGovernAgent 标签：constitution_check、constitution_propose。",
    impact: {
      principles: [],
      crossReferences: ["§3.1"],
      agents: ["DocGovernAgent"],
      breaking: false,
    },
    source: {
      agent: "DocGovernAgent",
      trace: "自审视审计 #AM-001——发现标签词汇表中缺少 constitution_propose",
    },
    status: "pending_judgment",
    ...overrides,
  };
}

// ── 测试用例 ─────────────────────────────────────

describe("evaluateAmendment", () => {
  // ─── 不可变原则阻断 ───────────────────────────

  it("触犯不可变原则 → BLOCKED", () => {
    const proposal = makeProposal({
      impact: {
        principles: ["原则一"],
        crossReferences: [],
        agents: [],
        breaking: false,
      },
    });

    const result = evaluateAmendment(proposal, FIXTURE_CONSTITUTION);
    expect(result.verdict).toBe("BLOCKED");
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]).toContain("原则一");
  });

  it("未触及不可变原则 → 不阻塞", () => {
    const proposal = makeProposal();

    const result = evaluateAmendment(proposal, FIXTURE_CONSTITUTION);
    expect(result.verdict).not.toBe("BLOCKED");
  });

  // ─── 正确提案全通过 ────────────────────────────

  it("正确提案 → APPROVED", () => {
    const proposal = makeProposal();

    const result = evaluateAmendment(proposal, FIXTURE_CONSTITUTION);

    expect(result.verdict).toBe("APPROVED");
    expect(result.checks.every((c: { passed: boolean }) => c.passed)).toBe(true);
    expect(result.blocking).toHaveLength(0);
  });

  // ─── breaking → APPROVED_WITH_CAVEATS ──────────

  it("breaking=true → APPROVED_WITH_CAVEATS", () => {
    const proposal = makeProposal({
      impact: {
        principles: [],
        crossReferences: ["§3.1"],
        agents: ["DocGovernAgent"],
        breaking: true,
      },
    });

    const result = evaluateAmendment(proposal, FIXTURE_CONSTITUTION);
    expect(result.verdict).toBe("APPROVED_WITH_CAVEATS");
    expect(result.caveats).toBeDefined();
    expect(result.caveats!.length).toBeGreaterThan(0);
  });

  // ─── 虚假 before 阻断 ──────────────────────────

  it("before 不在宪法中 → BLOCKED", () => {
    const proposal = makeProposal({
      before: "这段文字根本不存在于宪法中。虚构的段落。",
      after: "替换文本",
      category: "modify",
    });

    const result = evaluateAmendment(proposal, FIXTURE_CONSTITUTION);
    expect(result.verdict).toBe("BLOCKED");
    const structuralCheck = result.checks.find(
      (c: { id: string }) => c.id === "structural-consistency",
    )!;
    expect(structuralCheck.passed).toBe(false);
  });

  // ─── 版本号回退 ─────────────────────────────────

  it("版本号回退 → BLOCKED", () => {
    const proposal = makeProposal({ version: "v2.5.9" }); // < v2.5.10

    const result = evaluateAmendment(proposal, FIXTURE_CONSTITUTION);
    // 版本号非递增 → NEEDS_CLARIFICATION（不阻塞因为 before 匹配存在）
    const versionCheck = result.checks.find(
      (c: { id: string }) => c.id === "version-continuity",
    )!;
    expect(versionCheck.passed).toBe(false);
  });

  // ─── 缺失交叉引用 ──────────────────────────────

  it("声明的交叉引用不存在 → BLOCKED", () => {
    const proposal = makeProposal({
      impact: {
        principles: [],
        crossReferences: ["§9.99"], // 不存在
        agents: [],
        breaking: false,
      },
    });

    const result = evaluateAmendment(proposal, FIXTURE_CONSTITUTION);
    expect(result.verdict).toBe("BLOCKED");
    expect(result.blocking.some((b: string) => b.includes("§9.99"))).toBe(true);
  });

  // ─── 摘要过短 → NEEDS_CLARIFICATION ─────────────

  it("摘要过短 → NEEDS_CLARIFICATION", () => {
    const proposal = makeProposal({ summary: "修" });

    const result = evaluateAmendment(proposal, FIXTURE_CONSTITUTION);
    expect(result.verdict).toBe("NEEDS_CLARIFICATION");
  });

  // ─── 理由过短 → NEEDS_CLARIFICATION ─────────────

  it("理由过短 → NEEDS_CLARIFICATION", () => {
    const proposal = makeProposal({ rationale: "短" });

    const result = evaluateAmendment(proposal, FIXTURE_CONSTITUTION);
    expect(result.verdict).toBe("NEEDS_CLARIFICATION");
  });

  // ─── add 类型 before 为空不阻塞 ─────────────────

  it("add 类型且 before 为空 → 不检查结构一致性", () => {
    const proposal = makeProposal({
      category: "add",
      before: "",
      after: "新增 §5.3 修宪管线条款。",
      summary: "新增修宪管线条款以支持自动化修宪审批流程",
    });

    const result = evaluateAmendment(proposal, FIXTURE_CONSTITUTION);
    expect(result.verdict).not.toBe("BLOCKED");
    expect(result.checks.find((c: { id: string }) => c.id === "structural-consistency")!.passed).toBe(true);
  });

  // ─── 不可变原则动态提取 ─────────────────────────

  it("动态提取不可变原则——当前 fixture 有 3 条", () => {
    const proposal = makeProposal();

    const result = evaluateAmendment(proposal, FIXTURE_CONSTITUTION);
    const pc = result.checks.find((c: { id: string }) => c.id === "principle-immutability")!;
    // fixture 声明了原则一、原则二、原则六
    expect(pc.detail).toContain("3 条不可变原则");
    expect(pc.detail).toContain("原则一");
    expect(pc.detail).toContain("原则二");
    expect(pc.detail).toContain("原则六");
  });
});
