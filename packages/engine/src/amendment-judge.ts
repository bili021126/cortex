/**
 * 修宪提案评判引擎。
 *
 * 裁决权二分：
 *   - 开拓者：最终决定权，修改宪法文本
 *   - 昔涟：读取提案、输出评判，不擅自落笔
 *
 * evaluateAmendment() 对照宪法全文逐项检查提案的合规性、一致性和风险。
 *
 * @module amendment-judge
 */

import type { AmendmentProposal, JudgmentResult, JudgmentCheck, JudgmentVerdict } from "@cortex/shared";

/** 宪法中当前声明为不可变的原则——动态提取，非硬编码 */
function extractPrinciples(constitution: string): string[] {
  const principles: string[] = [];
  // 匹配 "**原则N** | ... | 不可变" 格式的表格行
  const re = /\*\*(原则[一二三四五六七八九十]+)\*\*\s*\|[^|]+\|\s*不可变/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(constitution)) !== null) {
    principles.push(m[1]);
  }
  return principles;
}

/** 从宪法头部提取当前版本号 */
function extractCurrentVersion(constitution: string): string {
  const m = constitution.match(/\*\*版本\*\*[：:]\s*(v[\d.]+)/);
  return m ? m[1] : "unknown";
}

/** 简易语义版本号比较：a > b 为 true */
function versionGt(a: string, b: string): boolean {
  const parse = (v: string) =>
    v.replace(/^v/, "").split(".").map(Number);
  const av = parse(a);
  const bv = parse(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const an = av[i] ?? 0;
    const bn = bv[i] ?? 0;
    if (an > bn) return true;
    if (an < bn) return false;
  }
  return false; // 相等
}

// ─── 检查项：原则不可变性 ─────────────────────────

function checkPrincipleImmutability(
  proposal: AmendmentProposal,
  constitution: string,
): JudgmentCheck {
  const declared = extractPrinciples(constitution);
  const violated = proposal.impact.principles.filter((p) =>
    declared.includes(p),
  );

  if (violated.length > 0) {
    return {
      id: "principle-immutability",
      name: `原则不可变性——提案声明触及 ${violated.length} 条不可变原则`,
      passed: false,
      detail: `以下原则标记为不可变，修宪提案不应修改其核心约束：${violated.join("、")}。若确需修改，须先在圆桌会议中讨论是否降级该原则的不可变等级，再走独立修宪流程。`,
    };
  }

  return {
    id: "principle-immutability",
    name: "原则不可变性——未触及不可变原则",
    passed: true,
    detail: `当前宪法声明 ${declared.length} 条不可变原则：${declared.join("、")}。提案未触及任何一条。`,
  };
}

// ─── 检查项：版本号连续性 ─────────────────────────

function checkVersionContinuity(
  proposal: AmendmentProposal,
  constitution: string,
): JudgmentCheck {
  const current = extractCurrentVersion(constitution);

  if (current === "unknown") {
    return {
      id: "version-continuity",
      name: "版本号连续性",
      passed: false,
      detail: "无法从宪法文本中提取当前版本号。请确认 **版本**： 行格式正确。",
    };
  }

  if (!versionGt(proposal.version, current)) {
    return {
      id: "version-continuity",
      name: "版本号连续性",
      passed: false,
      detail: `提案目标版本 ${proposal.version} 不大于当前版本 ${current}。修宪版本号必须递增。`,
    };
  }

  return {
    id: "version-continuity",
    name: "版本号连续性",
    passed: true,
    detail: `提案目标版本 ${proposal.version} > 当前版本 ${current}，符合递增规则。`,
  };
}

// ─── 检查项：结构一致性 ───────────────────────────

function checkStructuralConsistency(
  proposal: AmendmentProposal,
  constitution: string,
): JudgmentCheck {
  // add / restructure 的 before 可能为空，跳过检查
  if (proposal.category === "add" && !proposal.before.trim()) {
    return {
      id: "structural-consistency",
      name: "结构一致性——新增提案无需 before 匹配",
      passed: true,
      detail: "category=add，before 为空，跳过原文匹配检查。",
    };
  }

  // 标准化空白字符后做子串匹配
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  const normBefore = normalize(proposal.before);
  const normConst = normalize(constitution);

  if (!normConst.includes(normBefore)) {
    return {
      id: "structural-consistency",
      name: "结构一致性——before 段落未在宪法中找到匹配",
      passed: false,
      detail: `提案声明的"修改前原文"在宪法全文中未找到精确匹配。可能原因：(1) 原文已被其他修宪覆盖；(2) 复制时截断或格式化错误；(3) 提案基于过期版本。请重新提取原文重试。`,
    };
  }

  return {
    id: "structural-consistency",
    name: "结构一致性——before 段落匹配成功",
    passed: true,
    detail: "提案声明的原文在宪法全文中找到精确匹配。",
  };
}

// ─── 检查项：交叉引用完整性 ────────────────────────

function checkCrossReferences(
  proposal: AmendmentProposal,
  constitution: string,
): JudgmentCheck {
  const missing: string[] = [];
  for (const ref of proposal.impact.crossReferences) {
    // 简单检查：宪法中是否包含引用目标的标识（如 "§5.1" 或 "原则X"）
    if (!constitution.includes(ref)) {
      missing.push(ref);
    }
  }

  if (missing.length > 0) {
    return {
      id: "cross-reference-integrity",
      name: "交叉引用完整性",
      passed: false,
      detail: `以下声明的交叉引用在宪法全文中未找到：${missing.join("、")}。请确认这些引用是否确实存在，或修正 impact.crossReferences。`,
    };
  }

  return {
    id: "cross-reference-integrity",
    name: "交叉引用完整性",
    passed: true,
    detail: `全部 ${proposal.impact.crossReferences.length} 项交叉引用在宪法中存在。`,
  };
}

// ─── 检查项：影响范围合理性 ────────────────────────

function checkImpactScope(
  proposal: AmendmentProposal,
  constitution: string,
): JudgmentCheck {
  if (proposal.impact.agents.length === 0) {
    return {
      id: "impact-scope",
      name: "影响范围——无 Agent 受影响声明",
      passed: true,
      detail: "提案未声明任何 Agent 受影响。",
    };
  }

  // 检查目标章节附近的文本是否提及声明的 Agent
  const unmentioned: string[] = [];
  for (const agent of proposal.impact.agents) {
    if (!constitution.toLowerCase().includes(agent.toLowerCase())) {
      unmentioned.push(agent);
    }
  }

  if (unmentioned.length > 0) {
    return {
      id: "impact-scope",
      name: "影响范围合理性",
      passed: false,
      detail: `以下声明的受影响 Agent 在宪法全文中未出现：${unmentioned.join("、")}。请确认 (1) 是否为拼写错误 (2) 是否应为更通用的 AgentType。`,
    };
  }

  return {
    id: "impact-scope",
    name: "影响范围合理性",
    passed: true,
    detail: `声明的 ${proposal.impact.agents.length} 个受影响 Agent 在宪法中存在。`,
  };
}

// ─── 检查项：格式一致性 ────────────────────────────

function checkFormatConsistency(
  proposal: AmendmentProposal,
  _constitution: string,
): JudgmentCheck {
  // 基本检查：after 非空
  if (!proposal.after.trim()) {
    return {
      id: "format-consistency",
      name: "格式一致性",
      passed: false,
      detail: "提案的 after（修后文）为空。remove 型提案请使用 category=remove，add/modify/restructure 型提案必须提供非空 after。",
    };
  }

  // 检查 summary 长度
  if (proposal.summary.length < 10) {
    return {
      id: "format-consistency",
      name: "格式一致性——摘要过短",
      passed: false,
      detail: `摘要仅 ${proposal.summary.length} 字，修宪提案摘要应清晰说明变更内容（建议 ≥30 字）。`,
    };
  }

  // 检查 rationale 长度
  if (proposal.rationale.length < 20) {
    return {
      id: "format-consistency",
      name: "格式一致性——理由不充分",
      passed: false,
      detail: `修宪理由仅 ${proposal.rationale.length} 字，建议 ≥50 字以充分说明修宪必要性。`,
    };
  }

  return {
    id: "format-consistency",
    name: "格式一致性",
    passed: true,
    detail: "after 非空，summary 和 rationale 长度充足。",
  };
}

// ─── 主评判函数 ───────────────────────────────────

const CHECK_ORDER = [
  "principle-immutability",
  "version-continuity",
  "structural-consistency",
  "cross-reference-integrity",
  "impact-scope",
  "format-consistency",
] as const;

function determineVerdict(checks: JudgmentCheck[], proposal: AmendmentProposal): JudgmentVerdict {
  const principleCheck = checks.find((c) => c.id === "principle-immutability")!;
  const structuralCheck = checks.find((c) => c.id === "structural-consistency")!;
  const crossRefCheck = checks.find((c) => c.id === "cross-reference-integrity")!;

  // 触犯不可变原则 / before 伪造 / 虚假引用 → 直接阻塞
  if (!principleCheck.passed || !structuralCheck.passed || !crossRefCheck.passed) {
    return "BLOCKED";
  }

  const allPassed = checks.every((c) => c.passed);

  // 影响范围不明 / rationale 不充分 → 需要澄清
  if (!allPassed) {
    return "NEEDS_CLARIFICATION";
  }

  // 全部通过但 breaking=true → 附条件
  if (proposal.impact.breaking) {
    return "APPROVED_WITH_CAVEATS";
  }

  return "APPROVED";
}

/**
 * 评估修宪提案。
 *
 * @param proposal 修宪提案
 * @param constitution 宪法全文（当前版本内容）
 * @returns 评判结果——verdict + 逐项检查 + 阻塞项详情
 */
export function evaluateAmendment(
  proposal: AmendmentProposal,
  constitution: string,
): JudgmentResult {
  const checks: JudgmentCheck[] = [
    checkPrincipleImmutability(proposal, constitution),
    checkVersionContinuity(proposal, constitution),
    checkStructuralConsistency(proposal, constitution),
    checkCrossReferences(proposal, constitution),
    checkImpactScope(proposal, constitution),
    checkFormatConsistency(proposal, constitution),
  ];

  const verdict = determineVerdict(checks, proposal);

  const blocking = checks
    .filter((c) => !c.passed && (
      c.id === "principle-immutability" ||
      c.id === "structural-consistency" ||
      c.id === "cross-reference-integrity"
    ))
    .map((c) => c.detail);

  const caveats = verdict === "APPROVED_WITH_CAVEATS"
    ? [`提案声明 breaking=true——${proposal.impact.breaking ? "现有行为将被改变，请确认所有下游消费者已做好准备。" : ""}`]
    : undefined;

  return { verdict, checks, caveats, blocking };
}
