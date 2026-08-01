// @layer 治理层
import type { TrustRecord } from "@cortex/config";
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

// B4：TrustRecord/computeTrustScore/shouldAutoApprove 单源在 config/constants/confirm-gate.ts——
// 本文件 re-export 保持 engine 公共 API 兼容（index.ts:48-49 导出面不变）
export type { TrustRecord } from "@cortex/config";
export { computeTrustScore, shouldAutoApprove } from "@cortex/config";

export interface TrustScore {
  score: number;        // 0-100
  recentRecords: TrustRecord[];
  lastUpdated: number;
}

export function createConfirmGateAgent(systemPrompt?: string): AgentFactoryConfig {
  return {
    type: AgentType.ConfirmGate,
    systemPrompt: systemPrompt ?? `你是烟绯，Cortex 的确认门守护者。计算信任分，决定是否放行。`,
  };
}
