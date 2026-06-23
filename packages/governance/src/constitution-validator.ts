// ============================================================
// @cortex/governance —— 修宪提案九子约束验证器
//
// 原则七（宪法自约束）要求每次修宪提案必须通过以下九项检查。
// 在 judgeProposals() 之前调用，拒绝未通过的提案。
//
// 九子约束清单：
//   1. 显式引用条款 —— 提案是否引用了被修改的原条款编号
//   2. 完整记录     —— 提案是否包含 before/after 对比和 rationale
//   3. 最小改动     —— 是否只修改必要的条款，非大面积重写
//   4. 架构保护     —— 是否影响六层架构的层间接口和数据流向
//   5. 独立审计     —— 提案是否由非撰写方的 Agent 独立审计
//   6. 阶段限定     —— 是否标注了适用阶段（Core/Meso/Full）
//   7. 子约束修改规则 — 若修改原则七自身，需遵守元规则
//   8. 硬编码禁令   —— 提案是否引入新的硬编码配置值
//   9. 类型安全保障  — 提案涉及的接口变更是否通过类型校验
// ============================================================

import type { AmendmentProposal } from "./governance-loop.js";

/** 单条子约束检查结果 */
export interface SubConstraintVerdict {
  /** 子约束序号 1-9 */
  id: number;
  /** 子约束标题 */
  title: string;
  /** 是否通过 */
  passed: boolean;
  /** 未通过时的原因 */
  reason?: string;
}

/** 九子约束验证结果 */
export interface ConstitutionValidationResult {
  /** 是否全部通过 */
  passed: boolean;
  /** 逐条裁决 */
  verdicts: SubConstraintVerdict[];
}

/**
 * 对修宪提案执行原则七九子约束验证。
 * 任一条未通过 → passed=false + 未通过条目明细。
 */
export function validateConstitutionAmendment(
  proposal: AmendmentProposal,
  _allProposals?: AmendmentProposal[],
): ConstitutionValidationResult {
  const verdicts: SubConstraintVerdict[] = [];

  // ① 显式引用条款
  const hasClauseRef = Boolean(proposal.section && proposal.before);
  verdicts.push({
    id: 1,
    title: "显式引用条款",
    passed: hasClauseRef,
    reason: hasClauseRef ? undefined : "提案缺少 section 或 before 字段，无法定位被修改条款",
  });

  // ② 完整记录
  const hasFullRecord = Boolean(proposal.before && proposal.after && proposal.rationale);
  verdicts.push({
    id: 2,
    title: "完整记录",
    passed: hasFullRecord,
    reason: hasFullRecord ? undefined : "提案缺少 before/after/rationale 之一，记录不完整",
  });

  // ③ 最小改动
  const beforeLen = proposal.before?.length ?? 0;
  const afterLen = proposal.after?.length ?? 0;
  const isMinimal = afterLen < beforeLen * 3; // 改动后文本不超过原文 3 倍
  verdicts.push({
    id: 3,
    title: "最小改动",
    passed: isMinimal,
    reason: isMinimal ? undefined : `改动幅度过大: before=${beforeLen} → after=${afterLen}`,
  });

  // ④ 架构保护（启发式：检查是否涉及 agents/core/memory/pipeline 等关键路径）
  const hasArchImpact = proposal.impact?.toLowerCase().includes("agent")
    || proposal.impact?.toLowerCase().includes("pipeline")
    || proposal.impact?.toLowerCase().includes("core")
    || proposal.impact?.toLowerCase().includes("memory");
  verdicts.push({
    id: 4,
    title: "架构保护",
    passed: !hasArchImpact || proposal.impact?.toLowerCase().includes("架构影响: 已验证") !== undefined,
    reason: hasArchImpact && !proposal.impact?.includes("架构影响: 已验证")
      ? "提案影响架构关键路径但未在 impact 中标注'架构影响: 已验证'"
      : undefined,
  });

  // ⑤ 独立审计（由 governance-loop 调用时，提案应标记已审计）
  const isAudited = proposal.status === "pending_judgment";
  verdicts.push({
    id: 5,
    title: "独立审计",
    passed: isAudited,
    reason: isAudited ? undefined : "提案 status 应为 pending_judgment（表明已通过独立审计）",
  });

  // ⑥ 阶段限定
  const hasPhase = proposal.summary?.includes("[Core") || proposal.summary?.includes("[Meso") || proposal.summary?.includes("[Full");
  verdicts.push({
    id: 6,
    title: "阶段限定",
    passed: hasPhase,
    reason: hasPhase ? undefined : "提案未标注适用阶段（[Core]/[Meso]/[Full]）",
  });

  // ⑦ 子约束修改规则（若修改原则七自身，需特殊标记）
  const modifiesP7 = proposal.section?.includes("原则七");
  verdicts.push({
    id: 7,
    title: "子约束修改规则",
    passed: !modifiesP7 || proposal.summary?.includes("[元规则]") === true,
    reason: modifiesP7 && !proposal.summary?.includes("[元规则]")
      ? "修改原则七自身需在 summary 中标注 [元规则]"
      : undefined,
  });

  // ⑧ 硬编码禁令（启发式：检查 after 中是否包含硬编码值）
  const hasHardcoded = afterLen > 0 && (
    (proposal.after?.includes(": 32000") ?? false)
    || (proposal.after?.includes('"localhost"') ?? false)
    || (/:s*d{5,}/).test(proposal.after ?? '')
  );
  verdicts.push({
    id: 8,
    title: "硬编码禁令",
    passed: !hasHardcoded,
    reason: hasHardcoded ? "提案可能引入了新的硬编码配置值" : undefined,
  });

  // ⑨ 类型安全保障（由 CI 门禁 tsc --noEmit 覆盖，此处检查提案是否提及类型变更）
  const hasTypeChange = proposal.impact?.toLowerCase().includes("type") || proposal.impact?.toLowerCase().includes("interface");
  verdicts.push({
    id: 9,
    title: "类型安全保障",
    passed: !hasTypeChange || proposal.summary?.includes("[类型已校验]") === true,
    reason: hasTypeChange && !proposal.summary?.includes("[类型已校验]")
      ? "提案涉及类型/接口变更但未标注 [类型已校验]"
      : undefined,
  });

  return {
    passed: verdicts.every(v => v.passed),
    verdicts,
  };
}
