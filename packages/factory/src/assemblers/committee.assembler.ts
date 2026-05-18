// ============================================================
// @cortex/factory — 委员会组装器
//
// 将 committeeRules 组装为可执行的委员会召集策略。
// ============================================================

import type { CommitteeRule } from "../types.js";

/** 组装后的委员会配置 */
export interface AssembledCommittee {
  /** 紧急召集规则（不排队） */
  urgent: CommitteeRule[];
  /** 常规召集规则（排队等议程） */
  normal: CommitteeRule[];
}

/**
 * 将 committeeRules 按紧急/常规分组。
 */
export function assembleCommittee(rules: CommitteeRule[]): AssembledCommittee {
  const urgent: CommitteeRule[] = [];
  const normal: CommitteeRule[] = [];

  for (const rule of rules) {
    if (rule.urgent) {
      urgent.push(rule);
    } else {
      normal.push(rule);
    }
  }

  return { urgent, normal };
}
