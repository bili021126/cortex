/**
 * GovernanceLoop —— 治理闭环编排器。
 *
 * 裁决权二分：
 *   - 开拓者：最终决定权，修改宪法文本
 *   - 昔涟：读取提案、输出评判，不擅自落笔
 *
 * 串联完整链路：
 *   凝光审计 → 发现缺陷 → 生成 AmendmentProposal → 昔涟评判
 *   → 开拓者裁决 → 写入宪法 → build+test 验证 → 治理记录归档
 *
 * @module governance-loop
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AmendmentProposal,
  JudgmentResult,
  AmendmentApplyResult,
} from "@cortex/shared";
import { evaluateAmendment } from "./amendment-judge.js";
import { applyAmendment } from "./amendment-applier.js";

// ─── 常量 ───────────────────────────────────────

/** 修宪提案归档目录（相对于项目根目录） */
const AMENDMENTS_DIR = "docs/amendments";

/** 宪法文件路径（相对于项目根目录） */
const CONSTITUTION_RELATIVE = "docs/constitution/Cortex 概念顶层设计 v2.5.md";

// ─── 提案管理 ──────────────────────────────────

/**
 * 从 amendments 目录读取所有待决提案。
 * 只返回 status 为 "draft" 或 "pending_judgment" 的提案。
 */
export function loadPendingProposals(rootDir: string): AmendmentProposal[] {
  const dir = path.resolve(rootDir, AMENDMENTS_DIR);
  if (!fs.existsSync(dir)) return [];

  const proposals: AmendmentProposal[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, entry.name), "utf-8");
      const p = JSON.parse(raw) as AmendmentProposal;
      if (p.status === "draft" || p.status === "pending_judgment") {
        proposals.push(p);
      }
    } catch {
      // 跳过格式错误的文件
    }
  }
  return proposals;
}

/**
 * 将提案保存到 amendments 目录。
 * 文件名取决于 proposal.id（如 AM-2026-0515-001.json）。
 */
export function saveProposal(
  proposal: AmendmentProposal,
  rootDir: string,
): void {
  const dir = path.resolve(rootDir, AMENDMENTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${proposal.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(proposal, null, 2), "utf-8");
}

/**
 * 更新已存提案的状态。
 */
export function updateProposalStatus(
  proposalId: string,
  status: AmendmentProposal["status"],
  rootDir: string,
): void {
  const dir = path.resolve(rootDir, AMENDMENTS_DIR);
  const filePath = path.join(dir, `${proposalId}.json`);
  if (!fs.existsSync(filePath)) return;

  const raw = fs.readFileSync(filePath, "utf-8");
  const p = JSON.parse(raw) as AmendmentProposal;
  p.status = status;
  fs.writeFileSync(filePath, JSON.stringify(p, null, 2), "utf-8");
}

// ─── 评判批处理 ────────────────────────────────

/** 批量评判结果 */
export interface BatchJudgment {
  proposalId: string;
  proposal: AmendmentProposal;
  judgment: JudgmentResult;
}

/**
 * 批量评判所有待决提案。
 *
 * @param rootDir 项目根目录——用于读取宪法全文
 * @returns 每条提案的评判结果
 */
export function judgeProposals(rootDir: string): BatchJudgment[] {
  const constitutionPath = path.resolve(rootDir, CONSTITUTION_RELATIVE);

  if (!fs.existsSync(constitutionPath)) {
    throw new Error(`宪法文件不存在：${constitutionPath}`);
  }

  const constitution = fs.readFileSync(constitutionPath, "utf-8");
  const proposals = loadPendingProposals(rootDir);

  return proposals.map((p) => ({
    proposalId: p.id,
    proposal: p,
    judgment: evaluateAmendment(p, constitution),
  }));
}

// ─── 裁决执行 ──────────────────────────────────

/**
 * 对已裁决通过的提案执行修宪写入。
 * 同时更新提案状态为 "applied"。
 *
 * @param proposal 已通过的提案
 * @param rootDir 项目根目录
 * @returns 写入结果
 */
export function applyApproved(
  proposal: AmendmentProposal,
  rootDir: string,
): AmendmentApplyResult {
  if (proposal.status !== "approved") {
    return {
      success: false,
      appliedVersion: proposal.version,
      error: `提案状态为 "${proposal.status}"，必须是 "approved" 才能执行写入`,
      filePath: "",
    };
  }

  const result = applyAmendment(proposal, path.resolve(rootDir, "docs/constitution"));

  if (result.success) {
    updateProposalStatus(proposal.id, "applied", rootDir);
  }

  return result;
}

// ─── 治理摘要 ──────────────────────────────────

/** 治理闭环状态摘要 */
export interface GovernanceSummary {
  /** 待评判的提案数 */
  pendingJudgment: number;
  /** 已通过待执行的提案数 */
  approved: number;
  /** 已被阻塞的提案数 */
  blocked: number;
  /** 已应用的提案数 */
  applied: number;
  /** 逐条提案的评判结果 */
  judgments: BatchJudgment[];
}

/**
 * 生成治理闭环的当前状态摘要。
 * 供昔涟向开拓者呈报。
 */
export function summarizeGovernance(rootDir: string): GovernanceSummary {
  const judgments = judgeProposals(rootDir);
  const dir = path.resolve(rootDir, AMENDMENTS_DIR);

  let applied = 0;
  let approved = 0;

  // 统计所有提案（不仅仅是待决的）
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const raw = fs.readFileSync(path.join(dir, entry.name), "utf-8");
        const p = JSON.parse(raw) as AmendmentProposal;
        if (p.status === "applied") applied++;
        else if (p.status === "approved") approved++;
      } catch { /* skip */ }
    }
  }

  const blocked = judgments.filter((j) => j.judgment.verdict === "BLOCKED").length;

  return {
    pendingJudgment: judgments.length,
    approved,
    blocked,
    applied,
    judgments,
  };
}
