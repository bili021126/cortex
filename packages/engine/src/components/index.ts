// @layer 规划-执行层
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
export { createAgent } from "../execution/agent-factory.js";
export type { AgentFactoryConfig } from "../execution/agent-factory.js";

// ── ReAct 循环 ──────────────────────────────────
export { runReActLoop } from "../execution/react-loop.js";
export type { ReActContext } from "../execution/react-loop.js";

// ── 技能提取 ─────────────────────────────────────
export { extractSkillsFromOutput, resolveOutputFile } from "@cortex/skill-kit";
export type { SkillExtractResult } from "@cortex/skill-kit";

// ── 技能持久化 ──────────────────────────────────
export { persistSkillsToMemory, loadSkillsFromMemory, scanOutputFilesForSkills, crystallizeSkillToKnowledge, verifySkillKnowledge, searchExternalEvidence } from "@cortex/skill-kit";
export type { CrystallizeOptions, CrystallizeResult, KnowledgeMetadata, ExternalSearcher, VerifyOptions, VerifyResult } from "@cortex/skill-kit";

// ── 外源技能 JSON 校验与转化 ────────────────────
export { validateExternalSkillJson, externalJsonToSkillTemplate, importExternalSkill } from "@cortex/skill-kit";
export type { SkillJsonValidationResult, SkillJsonValidationError, SkillJsonValidationWarning, SkillJsonValidationInfo, SkillJsonValidator, SkillStatus } from "@cortex/skill-kit";

// ── 技能步骤模板渲染引擎 ──────────────────────────
export { SkillTemplateEngine } from "@cortex/skill-kit";
export type { TemplateEngineOptions, TemplateContext } from "@cortex/skill-kit";
