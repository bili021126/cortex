// ============================================================
// 🌿 Cortex 技能注册表 — 注册表专属错误类型
// 实现：阿贝多
//
// @moved-from projects/solo-flight/src/registry/errors.ts
// ============================================================

import { SkillErrorCode, type SkillError } from './types.js';

/** 创建技能错误 */
export function createSkillError(
  code: SkillErrorCode,
  message: string,
  details?: unknown,
  cause?: Error
): SkillError {
  return { code, message, details, cause };
}

/** 技能未找到错误 */
export function skillNotFound(skillId: string): SkillError {
  return createSkillError(
    SkillErrorCode.NOT_FOUND,
    `技能「${skillId}」未在注册表中找到`
  );
}

/** 循环依赖错误 */
export function circularDependency(skillId: string, chain: string[]): SkillError {
  return createSkillError(
    SkillErrorCode.CIRCULAR_DEPENDENCY,
    `技能「${skillId}」检测到循环依赖: ${chain.join(' → ')}`,
    { chain }
  );
}

/** 依赖执行失败错误 */
export function dependencyFailed(skillId: string, depId: string, reason: string): SkillError {
  return createSkillError(
    SkillErrorCode.DEPENDENCY_FAILED,
    `技能「${skillId}」的依赖「${depId}」执行失败: ${reason}`,
    { skillId, dependencyId: depId }
  );
}

/** 执行超时错误 */
export function executionTimeout(skillId: string, timeoutMs: number): SkillError {
  return createSkillError(
    SkillErrorCode.TIMEOUT,
    `技能「${skillId}」执行超时 (${timeoutMs}ms)`,
    { timeout: timeoutMs }
  );
}

/** 执行失败错误 */
export function executionFailed(skillId: string, reason: string, cause?: Error): SkillError {
  return createSkillError(
    SkillErrorCode.EXECUTION_FAILED,
    `技能「${skillId}」执行失败: ${reason}`,
    undefined,
    cause
  );
}

/** 校验失败错误 */
export function validationFailed(skillId: string, details: string): SkillError {
  return createSkillError(
    SkillErrorCode.VALIDATION_FAILED,
    `技能「${skillId}」输入校验失败: ${details}`
  );
}
