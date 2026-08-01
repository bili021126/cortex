// @layer 治理层
import { TRUST_AUTO_APPROVE_L2, TRUST_AUTO_APPROVE_L3, TRUST_BASE_SCORE, TRUST_L0_L1_BONUS } from "@cortex/config";
import { AgentType } from "@cortex/shared";
import type { AgentFactoryConfig } from "../execution/agent-factory.js";

/**
 * 烟绯（ConfirmGate Agent）—— 信任分计算 + 确认决策
 * 
 * 不是静态 L0-L3 分级，而是基于历史行为的动态信任分。
 * 信任分 ≥ 阈值 → 自动放行
 * 信任分 < 阈值 → 弹确认
 * 信任分持续下降 → Agent 降权
 */

export interface TrustRecord {
  agentType: string;
  toolName: string;
  success: boolean;
  riskLevel: "L0" | "L1" | "L2" | "L3";
  timestamp: number;
}

export interface TrustScore {
  score: number;        // 0-100
  recentRecords: TrustRecord[];
  lastUpdated: number;
}

export function computeTrustScore(records: TrustRecord[]): number {
  if (records.length === 0) return TRUST_BASE_SCORE;
  
  let score = TRUST_BASE_SCORE;
  for (const r of records.slice(-20)) {
    if (r.success) score += TRUST_L0_L1_BONUS;
    else score -= r.riskLevel === "L3" ? 15 : r.riskLevel === "L2" ? 8 : 3;
  }
  return Math.max(0, Math.min(100, score));
}

export function shouldAutoApprove(score: number, riskLevel: string): boolean {
  // L0-L1 始终自动通过
  if (riskLevel === "L0" || riskLevel === "L1") return true;
  // L2: 信任分 ≥ 阈值自动通过
  if (riskLevel === "L2") return score >= TRUST_AUTO_APPROVE_L2;
  // L3: 信任分 ≥ 阈值自动通过
  return score >= TRUST_AUTO_APPROVE_L3;
}

export function createConfirmGateAgent(systemPrompt?: string): AgentFactoryConfig {
  return {
    type: AgentType.ConfirmGate,
    systemPrompt: systemPrompt ?? `你是烟绯，Cortex 的确认门守护者。计算信任分，决定是否放行。`,
  };
}
