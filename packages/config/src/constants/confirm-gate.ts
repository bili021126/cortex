/** ConfirmGate 信任分自动放行阈值——可通过 agents.json 覆写 */
export const TRUST_AUTO_APPROVE_L2 = 70;  // L2 操作信任分 ≥ 此值自动放行
export const TRUST_AUTO_APPROVE_L3 = 85;  // L3 操作信任分 ≥ 此值自动放行
export const TRUST_BASE_SCORE = 50;        // 新 Agent 初始信任分
export const TRUST_L0_L1_BONUS = 0.5;      // L0/L1 操作加分
export const TRUST_L2_PENALTY = 8;         // L2 失败扣分
export const TRUST_L3_PENALTY = 15;        // L3 失败扣分

/** ConfirmGate bypass 模式有效期（毫秒） */
export const CONFIRM_GATE_BYPASS_TTL_MS = 300_000;
