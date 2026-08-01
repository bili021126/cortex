/** ConfirmGate 信任分自动放行阈值——可通过 agents.json 覆写 */
export const TRUST_AUTO_APPROVE_L2 = 70;  // L2 操作信任分 ≥ 此值自动放行
export const TRUST_AUTO_APPROVE_L3 = 85;  // L3 操作信任分 ≥ 此值自动放行
export const TRUST_BASE_SCORE = 50;        // 新 Agent 初始信任分
export const TRUST_L0_L1_BONUS = 0.5;      // L0/L1 操作加分
export const TRUST_L2_PENALTY = 8;         // L2 失败扣分
export const TRUST_L3_PENALTY = 15;        // L3 失败扣分
/** L0/L1 失败扣分（B4：公式单源用） */
export const TRUST_L0_L1_PENALTY = 3;

/** ConfirmGate bypass 模式有效期（毫秒） */
export const CONFIRM_GATE_BYPASS_TTL_MS = 300_000;

// ─── 信任分模型（B4 单源——原 engine confirm-gate-agent 与 scheduler confirm-gate 双实现收敛） ───

/** 信任分记录 */
export interface TrustRecord {
  agentType: string;
  toolName: string;
  success: boolean;
  riskLevel: "L0" | "L1" | "L2" | "L3";
  timestamp: number;
}

/**
 * 信任分计算——基于最近 20 条历史行为：
 * 成功加分、失败按风险级扣分，分数夹在 [0,100]。
 */
export function computeTrustScore(records: TrustRecord[]): number {
  if (records.length === 0) return TRUST_BASE_SCORE;
  let score = TRUST_BASE_SCORE;
  for (const r of records.slice(-20)) {
    if (r.success) score += TRUST_L0_L1_BONUS;
    else score -= r.riskLevel === "L3" ? TRUST_L3_PENALTY : r.riskLevel === "L2" ? TRUST_L2_PENALTY : TRUST_L0_L1_PENALTY;
  }
  return Math.max(0, Math.min(100, score));
}

/**
 * 自动放行决策（B4 单源）——L0/L1 始终放行，L2/L3 按信任分阈值。
 */
export function shouldAutoApprove(score: number, riskLevel: string): boolean {
  if (riskLevel === "L0" || riskLevel === "L1") return true;
  if (riskLevel === "L2") return score >= TRUST_AUTO_APPROVE_L2;
  return score >= TRUST_AUTO_APPROVE_L3;
}
