// ============================================================
// @cortex/shared/intent-clarification —— 意图确认结果契约
//
// 【定位】MetaAgent.clarifyIntent() 的返回结构。
// 提升到 shared 层，允许 TUI 等消费方直接依赖类型，
// 不必反向依赖 @cortex/engine。
// ============================================================

/** 意图确认结果——clarifyIntent() 返回 */
export interface IntentClarification {
  goal: string;
  actionType: "analysis" | "modification" | "audit" | "refactor" | "generation" | "inquiry";
  scope: string;
  constraints: string;
  unclear?: string;
  originalIntent: string;
}
