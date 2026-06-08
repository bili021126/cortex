// ============================================================
// @cortex/skill-validator — 技能 JSON 校验器（薄包装层）
//
// 核心校验逻辑已迁移至 @cortex/engine 的 skill-json-validator.ts。
// 本包保留为向后兼容的薄包装层，对外导出与原接口一致。
//
// @merged-into @cortex/engine/components/skill-json-validator.ts
// ============================================================

export {
  validateExternalSkillJson as validateSkillJson,
  externalJsonToSkillTemplate,
  importExternalSkill,
} from "@cortex/engine";

export type {
  SkillJsonValidationResult as ValidationResult,
  SkillJsonValidationError as ValidationError,
  SkillJsonValidationWarning as ValidationWarning,
  SkillJsonValidationInfo as ValidationInfo,
  SkillJsonValidator as SkillValidator,
  SkillStatus,
} from "@cortex/engine";
