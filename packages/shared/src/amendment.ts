/**
 * 修宪提案与评判结果类型。
 *
 * 裁决权二分：
 *   - 开拓者：最终决定权，修改宪法文本
 *   - 昔涟：读取提案、输出评判（合规性/一致性/风险），不擅自落笔
 *
 * @module amendment
 */

// ─── 修宪提案 ─────────────────────────────────────

export interface AmendmentProposal {
  /** 提案唯一 ID，如 "AM-2026-0515-001" */
  id: string;
  /** 目标宪法版本号，如 "v2.5.11" */
  version: string;
  /** 修改的章节标识，如 "§5.1"、"原则七" */
  section: string;
  /** 提案类型 */
  category: "add" | "modify" | "remove" | "restructure";
  /** 一句话摘要 */
  summary: string;
  /** 修宪理由——Agent 产出的详细论证 */
  rationale: string;
  /** 宪法原文（要替换/删除的段落） */
  before: string;
  /** 修后文（新增/替换后的段落） */
  after: string;
  /** 影响评估 */
  impact: AmendmentImpact;
  /** 来源追溯 */
  source: AmendmentSource;
  /** 提案生命周期状态 */
  status: AmendmentStatus;
}

export interface AmendmentImpact {
  /** 涉及的不可变原则编号列表，如 ["原则一", "原则七"] */
  principles: string[];
  /** 受影响的交叉引用——其他章节/文档中对目标章节的引用 */
  crossReferences: string[];
  /** 受影响的 Agent 类型列表 */
  agents: string[];
  /** 是否破坏现有行为（breaking change）。true 时需显式确认 */
  breaking: boolean;
}

export interface AmendmentSource {
  /** 发起提案的 Agent */
  agent: string;
  /** 追溯链——哪次审计/审查发现的，可引用 DocGovern 分区中的报告 */
  trace: string;
}

/** 提案生命周期状态机 */
export type AmendmentStatus =
  | "draft"               // Agent 草稿中
  | "pending_judgment"    // 已提交，等待评判
  | "approved"            // 开拓者裁决通过，待执行写入
  | "rejected"            // 开拓者裁决驳回
  | "applied";            // 已写入宪法文件

// ─── 评判结果 ─────────────────────────────────────

/** 评判裁决 */
export type JudgmentVerdict =
  | "APPROVED"
  | "APPROVED_WITH_CAVEATS"
  | "BLOCKED"
  | "NEEDS_CLARIFICATION";

export interface JudgmentResult {
  /** 裁决结论 */
  verdict: JudgmentVerdict;
  /** 逐项检查结果 */
  checks: JudgmentCheck[];
  /** 附条件通过时的注意事项 */
  caveats?: string[];
  /** 阻塞项详情——每项说明为什么阻塞 */
  blocking: string[];
}

export interface JudgmentCheck {
  /** 检查项 ID */
  id: string;
  /** 检查项名称 */
  name: string;
  /** 是否通过 */
  passed: boolean;
  /** 详情说明——未通过时说明原因 */
  detail: string;
}

// ─── 修宪执行结果 ─────────────────────────────────

export interface AmendmentApplyResult {
  /** 是否写入成功 */
  success: boolean;
  /** 写入后的实际版本号 */
  appliedVersion: string;
  /** 错误信息（失败时填充） */
  error?: string;
  /** 写入的完整文件路径 */
  filePath: string;
}
