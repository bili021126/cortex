/**
 * governance-memory.ts — 治理→记忆系统适配器
 *
 * 将治理层的文件系统状态同步到 MemoryStore，实现：
 *   治理层 ──写入──→ MemoryStore ──读取──→ 执行层
 *
 * 治理层不直接调用 engine，执行层不直接调用 governance。
 * 记忆系统是两者之间唯一的隔离/连接层。
 *
 * @since v2.7 — 治理-执行解耦
 */

import type { IMemoryStore, MemoryWriteInput, MemorySource } from "@cortex/shared";
import { loadPendingProposals, summarizeGovernance, checkTimeouts } from "./governance-loop.js";

// ─── 常量 ───────────────────────────────────────

/** 治理类记忆的 source 标识 */
const GOV_SOURCE: MemorySource = {
  agentType: "governance" as never,
  taskId: "governance-cycle",
};

// ─── 写入記憶 ──────────────────────────────────

/**
 * 将治理闭环的当前状态同步到 MemoryStore。
 *
 * 写入内容：
 *   1. 待决提案列表（kind=Governance, tag=proposal）
 *   2. 治理摘要（kind=Governance, tag=summary）
 *   3. 超时处置（kind=Governance, tag=timeout）
 *
 * @param rootDir 项目根目录
 * @param store MemoryStore 实例
 */
export async function syncGovernanceToMemory(
  rootDir: string,
  store: IMemoryStore,
): Promise<{ proposalsWritten: number; summaryWritten: boolean }> {
  // ── 1. 待决提案 ──
  const proposals = loadPendingProposals(rootDir);
  let proposalsWritten = 0;

  for (const p of proposals) {
    const input: MemoryWriteInput = {
      source: { ...GOV_SOURCE },
      kind: "Governance",
      summary: `[修宪提案] ${p.id}: ${p.summary.slice(0, 100)}`,
      semantic_gist: `${p.id}: ${p.rationale.slice(0, 200)}`,
      content_blob: {
        proposalId: p.id,
        summary: p.summary,
        version: p.version,
        status: p.status,
        section: p.section,
        category: p.category,
        rationale: p.rationale,
      },
    };
    await store.write(input);
    proposalsWritten++;
  }

  // ── 2. 治理摘要 ──
  let summaryWritten = false;
  const summary = summarizeGovernance(rootDir);
  const timeoutActions = checkTimeouts(rootDir);

  const summaryInput: MemoryWriteInput = {
    source: { ...GOV_SOURCE },
    kind: "Governance",
    summary: `[治理摘要] 待判${summary.pendingJudgment} 已通过${summary.approved} 阻塞${summary.blocked} 已应用${summary.applied}`,
    semantic_gist: JSON.stringify(summary),
    content_blob: {
      type: "governance_summary",
      summary,
      timeoutActions: timeoutActions.map((a) => ({
        proposalId: a.proposalId,
        action: a.action,
        reason: a.reason,
      })),
      timestamp: Date.now(),
    },
  };
  await store.write(summaryInput);
  summaryWritten = true;

  return { proposalsWritten, summaryWritten };
}
