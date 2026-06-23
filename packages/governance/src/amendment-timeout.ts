// ============================================================
// @cortex/engine/governance/amendment-timeout —— 提案超时处置
//
// 超时自动处置：
//   1. pending_judgment 超过 TTL → 自动标记为 needs_attention
//   2. draft 超过 TTL → 提示清理或推进
//   3. 多次超时 → 升级为 rejected（僵尸提案清理）
//
// @since Core-2
// ============================================================

import type { AmendmentProposal } from "@cortex/shared";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── 类型 ──────────────────────────────────────────

/** 超时处置动作 */
export interface TimeoutAction {
  /** 提案 ID */
  proposalId: string;
  /** 当前状态 */
  currentStatus: string;
  /** 建议动作 */
  action: "needs_attention" | "warn_stale" | "auto_reject" | "auto_close";
  /** 超时天数 */
  daysPending: number;
  /** 人类可读的原因 */
  reason: string;
}

/** 超时配置 */
export interface TimeoutConfig {
  /** pending_judgment 超时天数（默认 7 天） */
  judgmentTTLDays: number;
  /** draft 超时天数（默认 14 天） */
  draftTTLDays: number;
  /** 连续超时自动拒绝的阈值（默认 3 次） */
  maxStaleCount: number;
}

const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  judgmentTTLDays: 7,
  draftTTLDays: 14,
  maxStaleCount: 3,
};

// ─── 核心逻辑 ────────────────────────────────────

/**
 * 检查提案超时，返回处置动作列表。
 *
 * @param proposals 待检查的提案列表
 * @param amendmentsDir 修宪提案目录（用于读取文件修改时间）
 * @param config 超时配置（可选）
 * @returns 超时处置动作（空数组表示无需处置）
 */
export function checkTimeout(
  proposals: AmendmentProposal[],
  amendmentsDir: string,
  config: Partial<TimeoutConfig> = {},
): TimeoutAction[] {
  const cfg = { ...DEFAULT_TIMEOUT_CONFIG, ...config };
  const now = Date.now();
  const actions: TimeoutAction[] = [];

  for (const proposal of proposals) {
    // 只检查草稿和待决提案
    if (proposal.status !== "draft" && proposal.status !== "pending_judgment") {
      continue;
    }

    // 读取文件最后修改时间作为代理
    const filePath = path.join(amendmentsDir, `${proposal.id}.json`);
    const daysPending = getDaysSinceModified(filePath, now);

    if (proposal.status === "pending_judgment") {
      if (daysPending > cfg.judgmentTTLDays) {
        const staleCount = getStaleCount(proposal.id, amendmentsDir);
        if (staleCount >= cfg.maxStaleCount) {
          actions.push({
            proposalId: proposal.id,
            currentStatus: proposal.status,
            action: "auto_reject",
            daysPending,
            reason: `提案 ${proposal.id} 等待评判超过 ${daysPending} 天（TTL: ${cfg.judgmentTTLDays} 天），` +
              `已连续 ${staleCount} 次超时，建议自动拒绝并归档。`,
          });
        } else {
          actions.push({
            proposalId: proposal.id,
            currentStatus: proposal.status,
            action: "needs_attention",
            daysPending,
            reason: `提案 ${proposal.id} 等待评判超过 ${daysPending} 天（TTL: ${cfg.judgmentTTLDays} 天），` +
              `请开拓者尽快裁决（第 ${staleCount} 次提醒）。`,
          });
        }
      }
    } else if (proposal.status === "draft") {
      if (daysPending > cfg.draftTTLDays) {
        actions.push({
          proposalId: proposal.id,
          currentStatus: proposal.status,
          action: "warn_stale",
          daysPending,
          reason: `草案 ${proposal.id} 已停滞 ${daysPending} 天（TTL: ${cfg.draftTTLDays} 天），` +
            `建议推进为 pending_judgment 或关闭。`,
        });
      }
    }
  }

  return actions;
}

// ─── 工具函数 ────────────────────────────────────

/**
 * 获取文件的最后修改时间至今的天数。
 * 文件不存在时返回 0（新提案，尚未写入文件）。
 */
function getDaysSinceModified(filePath: string, now: number): number {
  try {
    const stat = fs.statSync(filePath);
    return Math.floor((now - stat.mtimeMs) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

/**
 * 读取超时计数文件（简单追��）。
 * 存储格式：每行 "proposalId:count"
 */
function getStaleCount(proposalId: string, amendmentsDir: string): number {
  const counterPath = path.join(amendmentsDir, ".timeout-counters.json");
  try {
    const raw = fs.readFileSync(counterPath, "utf-8");
    const counters = JSON.parse(raw) as Record<string, number>;
    return counters[proposalId] ?? 1;
  } catch {
    return 1;
  }
}

/**
 * 更新超时计数（每次超时检查后调用）。 */
export function updateStaleCount(
  proposalId: string,
  amendmentsDir: string,
): void {
  const counterPath = path.join(amendmentsDir, ".timeout-counters.json");
  let counters: Record<string, number> = {};
  try {
    const raw = fs.readFileSync(counterPath, "utf-8");
    counters = JSON.parse(raw) as Record<string, number>;
  } catch {
    // 文件不存在，从头开始
  }
  counters[proposalId] = (counters[proposalId] ?? 0) + 1;
  fs.writeFileSync(counterPath + ".tmp", JSON.stringify(counters, null, 2), "utf-8");
  fs.renameSync(counterPath + ".tmp", counterPath);
}
