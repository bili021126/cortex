// ============================================================
// @cortex/memory — L0/L1/L2 三层记忆模型
//
// 适配：Cyrene-Agent 的 L0/L1/L2 → Cortex 的 MemoryEntry + kind 区分
//
// L0Profile / L1Profile 作为独立接口定义日常人格记忆，
// L2Memory 在 MemoryEntry 基础上扩展场景触发与冲突追踪。
//
// 保留 Cortex 两阶段提交 writePending→commitMemory 模式。
// ============================================================

import type { MemoryEntry } from "@cortex/shared";

// ─── L0：长期人格层（Agent 日常角色设定）─────────────

export interface L0Profile {
  kind: "L0";
  nickname: string;
  preferredName: string;
  occupation: string;
  longTermInterests: string;
  permanentNote: string;
  isPinned: boolean;
}

// ─── L1：短期语境层（当前回合偏好与目标）────────────

export interface L1Profile {
  kind: "L1";
  recentGoals: string;
  recentPreferences: string;
  currentProject: string;
  roundCount: number;
}

// ─── L2：场景触发记忆层（扩展 MemoryEntry）───────────

export interface L2Memory extends Omit<MemoryEntry, "kind"> {
  kind: "L2";
  triggerText: string;
  conflictWith?: string[];
  evidenceIds?: string[];
}
