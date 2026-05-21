/**
 * GovernancePipeline —— 治理管线编排器。
 *
 * 将分散的制度环节串联为一条端到端闭环：
 *   自审视 → 圆桌共识 → 修宪提案 → 昔涟评判 → 开拓者裁决 → 宪法写入 → CI 验证
 *
 * 设计原则：
 *   - 阶段可插拔：每阶段是独立的 Stage 函数，新增阶段只需 register
 *   - 裁决权二分：开拓者最终决定，昔涟只评判不落笔
 *   - 失败不扩散：任一阶段失败阻断下游，但不回滚已完成阶段
 *   - 拓展空间：通过 stageRegistry 可注册自定义阶段
 *
 * @module governance-pipeline
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AmendmentProposal, JudgmentResult } from "@cortex/shared";
import {
  loadPendingProposals,
  saveProposal,
  judgeProposals,
  applyApproved,
  summarizeGovernance,
  type BatchJudgment,
  type GovernanceSummary,
} from "./governance-loop.js";

// ─── 类型 ────────────────────────────────────────

/** 管线阶段标识 */
export type PipelineStageId =
  | "examination"       // 自审视
  | "roundtable"        // 圆桌共识
  | "amendment_draft"   // 修宪提案起草
  | "judgment"          // 昔涟评判
  | "ruler_decision"    // 开拓者裁决
  | "apply"             // 宪法写入
  | "ci_verify"         // CI 门禁验证
  | "archive";          // 归档

/** 阶段执行结果 */
export interface StageResult {
  stage: PipelineStageId;
  success: boolean;
  message: string;
  /** 阶段产出的数据（供下游阶段消费） */
  data?: unknown;
  /** 失败时阻断下游 */
  blocking: boolean;
}

/** 阶段执行函数 */
export type StageFn = (ctx: PipelineContext) => Promise<StageResult>;

/** 管线上下文——在阶段间传递共享状态 */
export interface PipelineContext {
  /** 项目根目录 */
  rootDir: string;
  /** 各阶段产物共享存储 */
  artifacts: Map<PipelineStageId, unknown>;
  /** 已执行阶段的结果 */
  stageResults: StageResult[];
  /** 用户回调：请求开拓者裁决 */
  onRulerDecision?: (proposals: BatchJudgment[]) => Promise<BatchJudgment[]>;
}

/** 管线配置 */
export interface PipelineConfig {
  /** 项目根目录 */
  rootDir: string;
  /** 启用的阶段列表（按序执行） */
  stages?: PipelineStageId[];
  /** 用户回调 */
  onRulerDecision?: (proposals: BatchJudgment[]) => Promise<BatchJudgment[]>;
  /** 阶段注册覆盖 */
  stageOverrides?: Partial<Record<PipelineStageId, StageFn>>;
}

/** 管线运行结果 */
export interface PipelineResult {
  success: boolean;
  /** 阻断阶段 ID（成功时为 null） */
  blockedAt: PipelineStageId | null;
  /** 各阶段结果 */
  stageResults: StageResult[];
  /** 治理摘要 */
  governance: GovernanceSummary;
}

// ─── 阶段注册表 ─────────────────────────────────

/** 全局阶段注册表——拓展点：注册自定义阶段 */
const stageRegistry = new Map<PipelineStageId, StageFn>();

/** 注册/覆写一个管线阶段 */
export function registerStage(id: PipelineStageId, fn: StageFn): void {
  stageRegistry.set(id, fn);
}

/** 注销一个管线阶段 */
export function unregisterStage(id: PipelineStageId): void {
  stageRegistry.delete(id);
}

/** 获取已注册的阶段列表 */
export function getRegisteredStages(): PipelineStageId[] {
  return Array.from(stageRegistry.keys());
}

// ─── 缺省阶段实现 ───────────────────────────────

/** 阶段：修宪评判——昔涟读取提案并输出评判 */
async function stageJudgment(ctx: PipelineContext): Promise<StageResult> {
  try {
    const judgments = judgeProposals(ctx.rootDir);

    if (judgments.length === 0) {
      return {
        stage: "judgment",
        success: true,
        message: "无待评判的修宪提案，跳过评判阶段",
        blocking: false,
      };
    }

    const blocked = judgments.filter((j) => j.judgment.verdict === "BLOCKED").length;
    const approved = judgments.filter((j) => j.judgment.verdict === "APPROVED" || j.judgment.verdict === "APPROVED_WITH_CAVEATS").length;
    const needsClarification = judgments.filter((j) => j.judgment.verdict === "NEEDS_CLARIFICATION").length;

    ctx.artifacts.set("judgment", judgments);

    const parts: string[] = [`${judgments.length} 条提案评判完成`];
    if (approved > 0) parts.push(`${approved} 条通过`);
    if (blocked > 0) parts.push(`${blocked} 条被阻塞`);
    if (needsClarification > 0) parts.push(`${needsClarification} 条需澄清`);

    return {
      stage: "judgment",
      success: true,
      message: parts.join("，"),
      data: judgments,
      blocking: false,
    };
  } catch (e) {
    return {
      stage: "judgment",
      success: false,
      message: `评判阶段失败: ${String(e).slice(0, 200)}`,
      blocking: true,
    };
  }
}

/** 阶段：开拓者裁决——在已评判的提案上由开拓者做最终决定 */
async function stageRulerDecision(ctx: PipelineContext): Promise<StageResult> {
  const judgments = ctx.artifacts.get("judgment") as BatchJudgment[] | undefined;

  if (!judgments || judgments.length === 0) {
    return {
      stage: "ruler_decision",
      success: true,
      message: "无待裁决提案",
      blocking: false,
    };
  }

  try {
    let decisions: BatchJudgment[];

    if (ctx.onRulerDecision) {
      // 用户提供裁决回调
      decisions = await ctx.onRulerDecision(judgments);
    } else {
      // 默认：全部 APPROVED/APPROVED_WITH_CAVEATS 通过，其余标记 rejected
      decisions = judgments.map((j) => {
        const verdict = j.judgment.verdict;
        if (verdict === "APPROVED" || verdict === "APPROVED_WITH_CAVEATS") {
          // 更新提案状态为 approved
          const p = { ...j.proposal, status: "approved" as const };
          saveProposal(p, ctx.rootDir);
          return { ...j, proposal: p };
        }
        // 阻塞或需澄清的标记为 rejected
        const p = { ...j.proposal, status: "rejected" as const };
        saveProposal(p, ctx.rootDir);
        return { ...j, proposal: p };
      });
    }

    ctx.artifacts.set("ruler_decision", decisions);

    const approved = decisions.filter((d) => d.proposal.status === "approved").length;
    const rejected = decisions.filter((d) => d.proposal.status === "rejected").length;

    return {
      stage: "ruler_decision",
      success: true,
      message: `裁决完成: ${approved} 条通过, ${rejected} 条驳回`,
      data: decisions,
      blocking: false,
    };
  } catch (e) {
    return {
      stage: "ruler_decision",
      success: false,
      message: `裁决阶段失败: ${String(e).slice(0, 200)}`,
      blocking: true,
    };
  }
}

/** 阶段：宪法写入——将已裁决通过的提案写入宪法 */
async function stageApply(ctx: PipelineContext): Promise<StageResult> {
  const decisions = ctx.artifacts.get("ruler_decision") as BatchJudgment[] | undefined;

  if (!decisions || decisions.length === 0) {
    return {
      stage: "apply",
      success: true,
      message: "无待执行的提案",
      blocking: false,
    };
  }

  const approved = decisions.filter((d) => d.proposal.status === "approved");
  if (approved.length === 0) {
    return {
      stage: "apply",
      success: true,
      message: "无已通过的提案需要写入宪法",
      blocking: false,
    };
  }

  const results: string[] = [];
  let allSuccess = true;

  for (const d of approved) {
    const result = applyApproved(d.proposal, ctx.rootDir);
    if (result.success) {
      results.push(`✅ ${d.proposal.id}: 宪法已更新至 ${result.appliedVersion}`);
    } else {
      results.push(`❌ ${d.proposal.id}: ${result.error}`);
      allSuccess = false;
    }
  }

  return {
    stage: "apply",
    success: allSuccess,
    message: results.join("\n"),
    data: results,
    blocking: !allSuccess,
  };
}

/** 阶段：CI 门禁验证——修宪写入后触发 build + typecheck + test */
async function stageCiVerify(ctx: PipelineContext): Promise<StageResult> {
  const applyResult = ctx.stageResults.find((r) => r.stage === "apply");

  // 仅当宪法被实际修改时才触发 CI
  const decisions = ctx.artifacts.get("ruler_decision") as BatchJudgment[] | undefined;
  const hasApplied = decisions?.some((d) => d.proposal.status === "approved") ?? false;

  if (!hasApplied) {
    return {
      stage: "ci_verify",
      success: true,
      message: "无修宪写入，跳过 CI 验证",
      blocking: false,
    };
  }

  try {
    // 调用 CI 门禁脚本（npx tsx scripts/ci-gate.ts）
    const { execSync } = await import("node:child_process");
    const ciScript = path.resolve(ctx.rootDir, "scripts", "ci-gate.ts");

    if (!fs.existsSync(ciScript)) {
      return {
        stage: "ci_verify",
        success: false,
        message: `CI 门禁脚本不存在: ${ciScript}`,
        blocking: false, // CI 失败不阻塞修宪，但需告警
      };
    }

    const output = execSync(`npx tsx "${ciScript}"`, {
      cwd: ctx.rootDir,
      encoding: "utf-8",
      timeout: 300_000, // 5 分钟超时
      stdio: "pipe",
    });

    const passed = !output.includes("FAIL") && !output.includes("Error");

    return {
      stage: "ci_verify",
      success: passed,
      message: passed
        ? `CI 门禁通过 ✅`
        : `CI 门禁发现问题 ⚠️\n${output.slice(0, 500)}`,
      data: output,
      blocking: false, // 不阻断，但标记失败
    };
  } catch (e) {
    return {
      stage: "ci_verify",
      success: false,
      message: `CI 门禁执行异常: ${String(e).slice(0, 300)}`,
      blocking: false,
    };
  }
}

/** 阶段：归档——生成治理摘要 */
async function stageArchive(ctx: PipelineContext): Promise<StageResult> {
  try {
    const summary = summarizeGovernance(ctx.rootDir);
    ctx.artifacts.set("archive", summary);

    return {
      stage: "archive",
      success: true,
      message: `治理归档完成: ${summary.applied} 条已应用, ${summary.approved} 条已通过待执行, ${summary.blocked} 条被阻塞`,
      data: summary,
      blocking: false,
    };
  } catch (e) {
    return {
      stage: "archive",
      success: false,
      message: `归档失败: ${String(e).slice(0, 200)}`,
      blocking: false, // 归档失败不阻塞
    };
  }
}

// ─── 默认阶段顺序 ────────────────────────────────

const DEFAULT_STAGES: PipelineStageId[] = [
  "judgment",       // 昔涟评判所有待决提案
  "ruler_decision", // 开拓者裁决
  "apply",          // 写入宪法
  "ci_verify",      // CI 门禁验证
  "archive",        // 生成摘要
];

// ─── 注册缺省阶段 ────────────────────────────────

registerStage("judgment", stageJudgment);
registerStage("ruler_decision", stageRulerDecision);
registerStage("apply", stageApply);
registerStage("ci_verify", stageCiVerify);
registerStage("archive", stageArchive);

// ─── 管线编排 ────────────────────────────────────

/**
 * 按序执行管线各阶段。
 *
 * - 阶段执行顺序由 config.stages 或 DEFAULT_STAGES 定义
 * - config.stageOverrides 可覆写任阶段实现
 * - 任一阶段返回 blocking=true 则阻断下游
 *
 * @param config 管线配置
 * @returns 管线完整运行结果
 */
export async function runPipeline(config: PipelineConfig): Promise<PipelineResult> {
  const { rootDir, stages = DEFAULT_STAGES, onRulerDecision } = config;

  const ctx: PipelineContext = {
    rootDir: path.resolve(rootDir),
    artifacts: new Map(),
    stageResults: [],
    onRulerDecision,
  };

  let blockedAt: PipelineStageId | null = null;

  for (const stageId of stages) {
    const stageFn = config.stageOverrides?.[stageId] ?? stageRegistry.get(stageId);

    if (!stageFn) {
      ctx.stageResults.push({
        stage: stageId,
        success: false,
        message: `阶段 "${stageId}" 未注册，跳过`,
        blocking: false,
      });
      continue;
    }

    const result = await stageFn(ctx);
    ctx.stageResults.push(result);

    if (!result.success && result.blocking) {
      blockedAt = stageId;
      break;
    }
  }

  // 末尾生成治理摘要
  const governance = summarizeGovernance(rootDir);

  return {
    success: blockedAt === null,
    blockedAt,
    stageResults: ctx.stageResults,
    governance,
  };
}

/**
 * 快捷版本：仅评判（不含写入），用于预览修宪影响。
 */
export async function previewPipeline(rootDir: string): Promise<{
  judgments: BatchJudgment[];
  summary: GovernanceSummary;
}> {
  const judgments = judgeProposals(rootDir);
  const summary = summarizeGovernance(rootDir);
  return { judgments, summary };
}
