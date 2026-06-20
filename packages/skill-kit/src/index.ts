// ============================================================
// @cortex/skill-kit —— 技能开发工具包
//
// @file-overview
// 横向解耦后，核心逻辑从 @cortex/engine 迁回本包。
// 本包负责：技能提取、技能持久化、技能模板渲染、技能 JSON 校验。
//
// @decouple Core-1 横向解耦 Phase 1
// @compress v2.7 — skill-validator 并入
// ============================================================

// ── 技能模板引擎 ────────────────────────────────
export { SkillTemplateEngine } from "./skill-template-engine.js";
export type { TemplateEngineOptions, TemplateContext } from "./skill-template-engine.js";
export type { TemplateDiagnostic } from "./skill-template-engine.js";

// ── 技能提取器 ──────────────────────────────────
export { extractSkillsFromOutput, resolveOutputFile } from "./skill-extractor.js";
export type { SkillExtractResult } from "./skill-extractor.js";

// ── 技能持久化 ──────────────────────────────────
export { persistSkillsToMemory, loadSkillsFromMemory, scanOutputFilesForSkills, crystallizeSkillToKnowledge, verifySkillKnowledge, searchExternalEvidence } from "./skill-persister.js";
export type { CrystallizeOptions, CrystallizeResult, KnowledgeMetadata, ExternalSearcher, VerifyOptions, VerifyResult } from "./skill-persister.js";

// ── 技能注册表 ──────────────────────────────────
export { SkillRegistry, deriveStatus } from "./skill-registry.js";

// ── 外源技能 JSON 校验与转化 ────────────────────
export {
  validateExternalSkillJson,
  externalJsonToSkillTemplate,
  importExternalSkill,
} from "./skill-json-validator.js";

export type {
  SkillJsonValidationResult,
  SkillJsonValidationError,
  SkillJsonValidationWarning,
  SkillJsonValidationInfo,
  SkillJsonValidator,
  SkillStatus,
} from "./skill-json-validator.js";

// ── 技能管线订阅者 ──────────────────────────────
export { registerSkillPipeline, emitSkillReferenced, extractSkillUsageFromOutput } from "./skill-pipeline.js";

