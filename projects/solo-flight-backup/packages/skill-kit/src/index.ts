// ============================================================================
// @cortex/skill-kit — Public API
//
// Barrel export for all public types and classes.
// ============================================================================

// ─── Types & Interfaces ────────────────────────────────────────────────────

export type {
  // Core contracts
  SkillDefinition,
  SkillExecutor,
  ExecutionContext,
  ExecutionResult,
  PromptTemplate,
  TemplateVariables,

  // Validation
  ValidationLevel,
  ValidationEntry,
  ValidationResult,
  ValidationRule,

  // Loader
  LoadResult,
  SourceReader,
  SkillParser,
  LoaderOptions,

  // Cache
  CacheStrategy,
  CacheOptions,
  CacheStats,

  // Executor
  ExecutorEvent,
  ExecutorEventListener,
  ExecutorOptions,
  ValidatorOptions,
} from './types.js';

export { TemplateRenderError } from './types.js';

// ─── Classes ───────────────────────────────────────────────────────────────

export { Cache } from './cache.js';
export { Loader } from './loader.js';
export { Validator } from './validator.js';
export { Executor } from './executor.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

export {
  renderTemplate,
  listTemplateVariables,
  validateTemplateVariables,
} from './template-engine.js';
