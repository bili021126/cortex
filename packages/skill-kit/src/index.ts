/**
 * @cortex/skill-kit — 技能开发工具包
 *
 * 提供一套简洁、类型安全的接口，使开发者能够：
 * 1. 定义技能 —— 以 .ts 模块或 .json 文件形式声明技能
 * 2. 动态加载 —— 支持 import() 运行时加载 .ts 技能模块
 * 3. 校验技能 —— 确保技能定义符合契约，包含完整元信息
 * 4. 执行技能 —— 提供统一的执行上下文、中止信号、超时控制
 * 5. 缓存技能 —— 缓存已解析的技能实例，避免重复加载
 * 6. 模板渲染 —— 为技能步骤的 prompt 模板提供渲染能力
 *
 * @packageDocumentation
 * @module @cortex/skill-kit
 */

// ============================================================
// 核心类型
// ============================================================

export {
  SkillCategory,
  SkillErrorCode,
  type SkillMeta,
  type SkillDefinition,
  type SkillContext,
  type SkillInitContext,
  type SkillLogger,
  type SkillOutput,
  type ExecutionMeta,
  type SkillError,
  type SkillManifest,
  type ValidationResult,
  type ValidationError,
  type ExecuteOptions,
  type CacheStats,
  type TemplateEngineOptions,
  type TemplateContext,
} from "./types.js";

// ============================================================
// 接口类型
// ============================================================

export type {
  SkillLoader,
  SkillValidator,
  SkillExecutor,
  SkillCache,
} from "./types.js";

// ============================================================
// 加载器
// ============================================================

export {
  DynamicImportLoader,
  type DynamicImportLoaderOptions,
} from "./loader.js";

// ============================================================
// 校验器
// ============================================================

export {
  SimpleSkillValidator,
  type SimpleSkillValidatorOptions,
} from "./validator.js";

// ============================================================
// 执行器
// ============================================================

export {
  PipelineExecutor,
  type PipelineExecutorOptions,
} from "./executor.js";

// ============================================================
// 缓存
// ============================================================

export {
  DefaultSkillCache,
  type DefaultSkillCacheOptions,
} from "./cache.js";

// ============================================================
// 模板引擎
// ============================================================

export {
  SimpleTemplateEngine,
} from "./template-engine.js";

// ============================================================
// 工厂（统一入口）
// ============================================================

export {
  SkillFactory,
  type SkillFactoryOptions,
} from "./factory.js";

