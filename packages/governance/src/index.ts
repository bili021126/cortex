// ============================================================
// @cortex/governance —— 修宪管线独立包
//
// v2.6.6: 从 @cortex/engine 拆出为独立包，零 engine 内部依赖。
// engine 通过 barrel 重导出保持向后兼容。
// ============================================================

// ── 评判引擎 ───────────────────────────────────
export { evaluateAmendment, registerAmendmentCheck, unregisterAmendmentCheck, getAmendmentChecks } from "./amendment-judge.js";
export type { AmendmentCheckFn, CheckRegistration } from "./amendment-judge.js";

// ── 修宪执行器 ─────────────────────────────────
export { applyAmendment, findConstitutionPath } from "./amendment-applier.js";

// ── 治理闭环 ───────────────────────────────────
export {
  loadPendingProposals, saveProposal, updateProposalStatus,
  judgeProposals, applyApproved, summarizeGovernance, checkTimeouts,
} from "./governance-loop.js";
export type { BatchJudgment, GovernanceSummary } from "./governance-loop.js";

// ── 治理管线 ───────────────────────────────────
export {
  runPipeline, previewPipeline, registerStage, unregisterStage, getRegisteredStages,
  emitConstitutionUpdated,
} from "./governance-pipeline.js";
export type {
  PipelineStageId, StageResult, StageFn, PipelineContext,
  PipelineConfig, PipelineResult,
} from "./governance-pipeline.js";

// ── 超时处置 ───────────────────────────────────
export { checkTimeout, updateStaleCount } from "./amendment-timeout.js";
export type { TimeoutAction, TimeoutConfig } from "./amendment-timeout.js";

// ── 文档注册中心 ───────────────────────────────
export { DocRegistry } from "./doc-registry.js";

// ── 原则七：宪法修宪验证 ──
export {
  validateConstitutionAmendment,
} from "./constitution-validator.js";
export type {
  SubConstraintVerdict,
  ConstitutionValidationResult,
} from "./constitution-validator.js";

// ── 治理→记忆适配器 ─────────────────────────────
export { syncGovernanceToMemory } from "./governance-memory.js";

// ── 记忆-现实一致性校验层（原 @cortex/consistency，v3.4 迁入 governance）──
export * from "./consistency/index.js";
