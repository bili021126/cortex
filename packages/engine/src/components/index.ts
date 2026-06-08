// ============================================================
// @cortex/engine/components —— 可组合组件桶导出
//
// @file-overview
// 本文件是 components/ 目录的统一对外接口。外部调用方应通过
// 此桶导入，而非直接引用内部文件，以保持封装边界。
//
// @version 2.1.0
// ============================================================

// ── Agent 工厂 ──────────────────────────────────
export { createAgent } from "./agent-factory.js";
export type { AgentFactoryConfig } from "./agent-factory.js";

// ── ReAct 循环 ──────────────────────────────────
export { runReActLoop } from "./react-loop.js";
export type { ReActContext } from "./react-loop.js";

// ── 技能提取 ─────────────────────────────────────
export { extractSkillsFromOutput, resolveOutputFile } from "./skill-extractor.js";
export type { SkillExtractResult } from "./skill-extractor.js";

// ── 技能持久化 ──────────────────────────────────
export { persistSkillsToMemory, loadSkillsFromMemory, scanOutputFilesForSkills, crystallizeSkillToKnowledge, verifySkillKnowledge, searchExternalEvidence } from "./skill-persister.js";
export type { CrystallizeOptions, CrystallizeResult, KnowledgeMetadata, ExternalSearcher, VerifyOptions, VerifyResult } from "./skill-persister.js";

// ── 外源技能 JSON 校验与转化 ────────────────────
export { validateExternalSkillJson, externalJsonToSkillTemplate, importExternalSkill } from "./skill-json-validator.js";
export type { SkillJsonValidationResult, SkillJsonValidationError, SkillJsonValidationWarning, SkillJsonValidationInfo, SkillJsonValidator, SkillStatus } from "./skill-json-validator.js";

// ── 技能步骤模板渲染引擎 ──────────────────────────
export { SkillTemplateEngine } from "./skill-template-engine.js";
export type { TemplateEngineOptions, TemplateContext } from "./skill-template-engine.js";
