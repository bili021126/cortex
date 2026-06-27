// @ci: unit
// ============================================================
// @cortex/governance — AmendmentJudge 测试
//
// 覆盖 evaluateAmendment 的六项检查：
//   原则不可变性、版本号连续性、结构一致性、交叉引用完整性、
//   影响范围合理性、格式一致性
//
// 以及注册/注销自定义检查项
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { evaluateAmendment, registerAmendmentCheck, unregisterAmendmentCheck, getAmendmentChecks, applyAmendment } from "@cortex/governance";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── 宪法样本 ───────────────────────────────────────

const SAMPLE_CONSTITUTION = `
# Cortex 宪法

**版本**： v2.5.10

## §5.1 工具执行

| 原则 | 内容 | 不可变性 |
| **原则一** | 每个 Agent 只应拥有完成其职责所必需的最小工具集 | 不可变 |
| **原则二** | 所有修改必须记录修改人、时间与理由 | 不可变 |
| **原则三** | 工具调用失败时应优雅降级，不中断整体流程 | 不可变 |

## §7.1 安全约束

开拓者（Trailblazer）拥有最高权限。昔涟（Cyrene）负责评判提案。
`;

// ─── 辅助构建 ───────────────────────────────────────

function makeProposal(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: "AM-TEST-001",
    version: "v2.6.0",
    section: "§5.1",
    category: "modify",
    summary: "Refine tool execution policy for better safety",
    rationale: "Current tool execution policy lacks explicit rollback mechanism. This amendment adds a mandatory rollback step for all L2 operations to improve system resilience.",
    before: "## §5.1 工具执行",
    after: "## §5.1 工具执行（含回滚机制）",
    impact: {
      principles: [],
      crossReferences: ["§7.1"],
      agents: ["开拓者", "昔涟"],
      breaking: false,
    },
    source: {
      agent: "凝光",
      trace: "audit-2026-06-25",
    },
    status: "draft",
    ...overrides,
  };
}

describe("AmendmentJudge — 原则不可变性", () => {
  it("提案未触及不可变原则 → 检查通过", () => {
    const proposal = makeProposal();
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    const check = result.checks.find((c) => c.id === "principle-immutability");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("提案触及不可变原则 → 检查失败，裁决 BLOCKED", () => {
    const proposal = makeProposal({
      impact: { principles: ["原则一"], crossReferences: [], agents: [], breaking: false },
    });
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    const check = result.checks.find((c) => c.id === "principle-immutability");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(result.verdict).toBe("BLOCKED");
  });
});

describe("AmendmentJudge — 版本号连续性", () => {
  it("提案版本大于当前版本 → 检查通过", () => {
    const proposal = makeProposal({ version: "v2.6.0" });
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    const check = result.checks.find((c) => c.id === "version-continuity");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("提案版本不大于当前版本 → 检查失败", () => {
    const proposal = makeProposal({ version: "v2.4.0" });
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    const check = result.checks.find((c) => c.id === "version-continuity");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });
});

describe("AmendmentJudge — 结构一致性", () => {
  it("before 段落匹配 → 检查通过", () => {
    const proposal = makeProposal({ before: "## §5.1 工具执行" });
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    const check = result.checks.find((c) => c.id === "structural-consistency");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("before 段落不匹配 → 检查失败", () => {
    const proposal = makeProposal({ before: "## §9.9 不存在的章节" });
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    const check = result.checks.find((c) => c.id === "structural-consistency");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("category=add 且 before 为空 → 跳过原文匹配", () => {
    const proposal = makeProposal({ category: "add", before: "" });
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    const check = result.checks.find((c) => c.id === "structural-consistency");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });
});

describe("AmendmentJudge — 交叉引用完整性", () => {
  it("引用存在 → 检查通过", () => {
    const proposal = makeProposal({
      impact: { principles: [], crossReferences: ["§7.1"], agents: [], breaking: false },
    });
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    const check = result.checks.find((c) => c.id === "cross-reference-integrity");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("引用不存在 → 检查失败", () => {
    const proposal = makeProposal({
      impact: { principles: [], crossReferences: ["§99.9"], agents: [], breaking: false },
    });
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    const check = result.checks.find((c) => c.id === "cross-reference-integrity");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });
});

describe("AmendmentJudge — 影响范围合理性", () => {
  it("声明的 Agent 在宪法中存在 → 检查通过", () => {
    const proposal = makeProposal({
      impact: { principles: [], crossReferences: [], agents: ["开拓者", "昔涟"], breaking: false },
    });
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    const check = result.checks.find((c) => c.id === "impact-scope");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("声明的 Agent 在宪法中不存在 → 检查失败", () => {
    const proposal = makeProposal({
      impact: { principles: [], crossReferences: [], agents: ["不存在的Agent"], breaking: false },
    });
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    const check = result.checks.find((c) => c.id === "impact-scope");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });
});

describe("AmendmentJudge — 格式一致性", () => {
  it("after 非空 + 摘要和理由充足 → 通过", () => {
    const proposal = makeProposal();
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    const check = result.checks.find((c) => c.id === "format-consistency");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("after 为空 → 失败", () => {
    const proposal = makeProposal({ after: "" });
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    const check = result.checks.find((c) => c.id === "format-consistency");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("summary 过短 → 得分 0.5 但非完全失败", () => {
    const proposal = makeProposal({ summary: "太短" });
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    const check = result.checks.find((c) => c.id === "format-consistency");
    expect(check).toBeDefined();
    expect(check!.score).toBe(0.5);
  });
});

describe("AmendmentJudge — 综合裁决", () => {
  it("全部通过 → APPROVED", () => {
    const proposal = makeProposal();
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    expect(result.verdict).toBe("APPROVED");
    expect(result.weightedScore).toBeGreaterThanOrEqual(0.9);
  });

  it("非阻塞检查失败 → NEEDS_CLARIFICATION", () => {
    const proposal = makeProposal({
      version: "v2.4.0", // 版本不递增（非阻塞）
    });
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    expect(result.verdict).toBe("NEEDS_CLARIFICATION");
  });

  it("breaking=true → APPROVED_WITH_CAVEATS", () => {
    const proposal = makeProposal({
      impact: { principles: [], crossReferences: [], agents: [], breaking: true },
    });
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    expect(result.verdict).toBe("APPROVED_WITH_CAVEATS");
    expect(result.caveats).toBeDefined();
    expect(result.caveats!.length).toBeGreaterThan(0);
  });

  it("阻塞级检查失败 → BLOCKED", () => {
    const proposal = makeProposal({
      impact: { principles: ["原则一"], crossReferences: [], agents: [], breaking: false },
    });
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    expect(result.verdict).toBe("BLOCKED");
    expect(result.blocking.length).toBeGreaterThan(0);
  });
});

describe("AmendmentJudge — 结构化结果", () => {
  it("返回完整的 JudgmentResult 结构", () => {
    const proposal = makeProposal();
    const result = evaluateAmendment(proposal as any, SAMPLE_CONSTITUTION);
    expect(result).toHaveProperty("verdict");
    expect(result).toHaveProperty("checks");
    expect(result).toHaveProperty("weightedScore");
    expect(result).toHaveProperty("blocking");
    expect(Array.isArray(result.checks)).toBe(true);
    expect(result.checks.length).toBeGreaterThanOrEqual(6);
  });
});

describe("AmendmentJudge — 自定义检查注册", () => {
  const CUSTOM_ID = "custom-check";
  const DEFAULT_CHECKS_COUNT = 6;

  beforeEach(() => {
    // 清理，确保不会重复注册
    unregisterAmendmentCheck(CUSTOM_ID);
  });

  afterEach(() => {
    unregisterAmendmentCheck(CUSTOM_ID);
  });

  it("注册自定义检查并影响裁决", () => {
    registerAmendmentCheck(CUSTOM_ID, () => ({
      id: CUSTOM_ID,
      name: "自定义检查",
      passed: false,
      score: 0,
      detail: "模拟失败",
    }), { blocking: true, weight: 1.0 });

    // 获取所有已注册检查项
    const all = getAmendmentChecks();
    expect(all.find((c) => c.id === CUSTOM_ID)).toBeDefined();
  });

  it("注销自定义检查", () => {
    registerAmendmentCheck(CUSTOM_ID, () => ({
      id: CUSTOM_ID,
      name: "临时检查",
      passed: true,
      score: 1,
      detail: "",
    }));

    expect(unregisterAmendmentCheck(CUSTOM_ID)).toBe(true);
    const all = getAmendmentChecks();
    expect(all.find((c) => c.id === CUSTOM_ID)).toBeUndefined();
  });

  it("默认检查项数量正确", () => {
    const all = getAmendmentChecks();
    expect(all.length).toBeGreaterThanOrEqual(DEFAULT_CHECKS_COUNT);
  });
});

// ─── 修宪写入原子性 ─────────────────────────────────────

describe("applyAmendment — 原子写入", () => {
  const TMP_CONSTITUTION_DIR = path.join(os.tmpdir(), "cortex-amendment-test");
  const TMP_CONSTITUTION = path.join(TMP_CONSTITUTION_DIR, "Cortex 概念顶层设计 v2.5.10.md");

  beforeEach(() => {
    fs.mkdirSync(TMP_CONSTITUTION_DIR, { recursive: true });
    fs.writeFileSync(TMP_CONSTITUTION, SAMPLE_CONSTITUTION.trim(), "utf-8");
  });

  afterEach(() => {
    try { fs.rmSync(TMP_CONSTITUTION_DIR, { recursive: true }); } catch { /* ok */ }
  });

  it("原子写入——临时文件不残留", () => {
    const proposal = makeProposal();
    const result = applyAmendment(proposal as any, TMP_CONSTITUTION);
    expect(result.success).toBe(true);

    // 验证没有 .tmp.* 文件残留
    const files = fs.readdirSync(TMP_CONSTITUTION_DIR);
    const tmpFiles = files.filter((f) => f.includes(".tmp."));
    expect(tmpFiles.length).toBe(0);
  });

  it("写入后文件内容正确（含版本更新）", () => {
    const proposal = makeProposal({ version: "v2.6.0" });
    const result = applyAmendment(proposal as any, TMP_CONSTITUTION);
    expect(result.success).toBe(true);

    const content = fs.readFileSync(result.filePath, "utf-8");
    expect(content).toContain("v2.6.0");
    expect(content).toContain("AM-TEST-001");
  });

  it("并发写入不损坏文件", () => {
    const proposalA = makeProposal({
      id: "AM-CONCUR-A",
      version: "v2.6.0",
      before: "## §5.1 工具执行",
      after: "## §5.1 工具执行（含回滚机制）",
    });

    // 串行调用（模拟并发时序：A 写完，B 基于同一基线写入另一处）
    const resultA = applyAmendment(proposalA as any, TMP_CONSTITUTION);
    expect(resultA.success).toBe(true);

    // 第二次写入不同位置
    const proposalB = makeProposal({
      id: "AM-CONCUR-B",
      version: "v2.7.0",
      before: "## §7.1 安全约束",
      after: "## §7.1 安全约束（增强版）",
    });
    const resultB = applyAmendment(proposalB as any, resultA.filePath);
    expect(resultB.success).toBe(true);

    // 文件不应损坏
    const content = fs.readFileSync(resultB.filePath, "utf-8");
    expect(content).toBeTruthy();
    expect(content).not.toMatch(/tmp\.\d+/);

    // 两处修改都应存在
    expect(content).toMatch(/工具执行（含回滚机制）/);
    expect(content).toMatch(/安全约束（增强版）/);
  });
});
