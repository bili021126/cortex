// ============================================================
// @cortex/config/constants/tiers —— ModelTier 校验常量
//
// Phase 4 收敛：消解 meta-agent.ts 和 scheduling-implementations.ts
// 之间的 _VALID_TIERS 双定义。
// ============================================================

/** 合法 tier 值集合（用于校验甘雨标注和分类器输出） */
export const VALID_TIERS: ReadonlySet<string> = new Set(["fast", "standard", "thinking"]);
