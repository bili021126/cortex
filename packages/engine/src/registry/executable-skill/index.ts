// ============================================================
// 🌿 Cortex 可执行技能注册表 — 模块入口
//
// 提供完整的可执行技能注册表系统，包括：
// - DefaultSkillRegistry：核心注册表实现
// - 类型定义：Skill, SkillMeta, ExecutionContext 等
// - 工具：ID 生成, 校验, 错误处理, 超时控制
// - 中间件：日志, 计时, 错误捕获
//
// @moved-from projects/solo-flight/src/
// ============================================================

// 核心注册表
export { DefaultSkillRegistry } from './default-registry.js';
export type { DefaultRegistryOptions } from './default-registry.js';

// 类型
export type {
  SkillId,
  SkillVersion,
  SkillMeta,
  SkillInput,
  SkillResult,
  SkillError,
  ExecutionMeta,
  ExecutionContext,
  ServiceContainer,
  Logger,
  MiddlewareContext,
  NextFunction,
  SkillMiddleware,
  RegistryFilter,
  RegisterOptions,
  RegistryEvent,
  RegistryEventHandler,
  Skill,
} from './types.js';

export {
  SkillCategory,
  SkillErrorCode,
} from './types.js';

// 接口
export type {
  SkillRegistry,
  IDependencyGraph,
  ISkillContainer,
  SkillScanner,
  SkillLoader,
} from './interfaces.js';

// 技能核心
export { BaseSkill } from './base-skill.js';
export { compose, createLoggingMiddleware, timingMiddleware, errorCatchMiddleware } from './middleware.js';
export { LifecycleManager } from './lifecycle.js';

// 上下文
export { DefaultExecutionContext } from './skill-execution-context.js';
export { DefaultServiceContainer } from './skill-service-container.js';

// 工具
export { ok, fail, isOk, isFail, tryCatch, tryCatchSync } from './utils/result.js';
export type { SimpleResult } from './utils/result.js';
export { createSkillId, createSkillVersion, safeCreateSkillId, safeCreateSkillVersion, generateTraceId } from './utils/id.js';
export { validateSkillMeta, formatValidationErrors } from './utils/validator.js';
export type { ValidationError } from './utils/validator.js';
export { withTimeout } from './utils/timer.js';

// 错误
export {
  createSkillError,
  skillNotFound,
  circularDependency,
  dependencyFailed,
  executionTimeout,
  executionFailed,
  validationFailed,
} from './errors.js';
