// ============================================================
// @cortex/skill-validator — 技能 JSON 校验器（薄包装层）
//
// 核心校验逻辑已迁移至 @cortex/engine/components/skill-json-validator.ts。
// 本包保留为向后兼容的薄包装层，对外导出与原接口一致。
//
// @module-convention
// 1. 凡 src/ 下新增公开类型/函数，必须在本文件追加 export 行。
// 2. 测试文件禁止 ../src/ 相对导入——只用 @cortex/skill-validator 包名导入。
// 3. 收益：文件合并/拆分/重命名——只要 barrel 出口不变，所有引用方无感。
// ============================================================

export {
  validateSkillJson,
} from "./validator.js";

export type {
  SkillStatus,
  SkillValidator,
  ValidationError,
  ValidationWarning,
  ValidationInfo,
  ValidationResult,
} from "./validator.js";
