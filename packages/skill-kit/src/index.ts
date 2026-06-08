// ============================================================
// @cortex/skill-kit —— 技能开发工具包（薄包装层）
//
// 核心逻辑已迁移至 @cortex/engine：
//   - SkillTemplateEngine   → @cortex/engine/components/skill-template-engine.ts
//   - validateExternalSkillJson → @cortex/engine/components/skill-json-validator.ts
//   - externalJsonToSkillTemplate → @cortex/engine/components/skill-json-validator.ts
//
// 可执行框架（SkillDefinition.execute / SkillFactory / PipelineExecutor 等）
// 已按宪法 §13 "技能即记忆" 原则废弃。
//
// 本包保留为向后兼容的薄包装层。
//
// @merged-into @cortex/engine
// ============================================================

export { SkillTemplateEngine } from "@cortex/engine";
export type { TemplateEngineOptions, TemplateContext } from "@cortex/engine";

export {
  validateExternalSkillJson,
  externalJsonToSkillTemplate,
  importExternalSkill,
} from "@cortex/engine";

export type {
  SkillJsonValidationResult,
  SkillJsonValidationError,
  SkillJsonValidationWarning,
  SkillJsonValidationInfo,
  SkillJsonValidator,
  SkillStatus,
} from "@cortex/engine";

