/**
 * @cortex/prompt-kit — 提示词工程工具包
 *
 * 提供一套声明式、可组合、类型安全的提示词管理接口，使开发者能够：
 * 1. 统一加载  — 从文件系统/配置/内联多来源加载 PromptTemplate
 * 2. 声明式组装 — 将语义块组合为完整 system prompt
 * 3. 模板渲染  — 支持变量插值、条件注入、角色切换、跨模板引用
 * 4. 校验缓存  — 校验 prompt 结构完整性，LRU 缓存减少重复 I/O
 * 5. 版本管理  — 记录 prompt 版本变更，支持版本回退与差异对比
 *
 * @packageDocumentation
 * @module @cortex/prompt-kit
 */

// ============================================================
// 核心类型
// ============================================================

export {
  PromptBlockType,
  PromptErrorCode,
  type PromptBlock,
  type PromptTemplate,
  type PromptContext,
  type PromptResult,
  type PromptLoadOptions,
  type PromptAssembly,
  type PromptCacheEntry,
  type CacheStats,
  type ValidationResult,
  type ValidationError,
  type SectionCheckResult,
  type VersionRecord,
  type VersionDiff,
  type OrchestratorOptions,
  type TemplateEngineOptions,
} from "./types.js";

// ============================================================
// 加载器
// ============================================================

export {
  PromptLoader,
  type PromptSource,
} from "./loader/prompt-loader.js";

export {
  FilePromptSource,
  type FilePromptSourceOptions,
} from "./loader/file-source.js";

export {
  ConfigPromptSource,
} from "./loader/config-source.js";

export {
  InlinePromptSource,
} from "./loader/inline-source.js";

// ============================================================
// 组装器
// ============================================================

export {
  PromptAssembler,
  type BlockPreprocessor,
  type BlockPostprocessor,
} from "./assembler/prompt-assembler.js";

// ============================================================
// 模板引擎
// ============================================================

export {
  PromptTemplateEngine,
} from "./template-engine/prompt-template-engine.js";

// ============================================================
// 校验器
// ============================================================

export {
  PromptValidator,
  type ValidationRule,
} from "./validator/prompt-validator.js";

// ============================================================
// 缓存
// ============================================================

export {
  PromptCache,
} from "./cache/prompt-cache.js";

// ============================================================
// 版本管理
// ============================================================

export {
  PromptVersion,
} from "./version/prompt-version.js";

// ============================================================
// 编排器（统一门面）
// ============================================================

export {
  PromptOrchestrator,
} from "./orchestrator/prompt-orchestrator.js";

// ============================================================
// 错误类型
// ============================================================

export {
  PromptError,
} from "./errors.js";
