// ============================================================
// 🌿 Cortex 技能注册表 — ID 生成与校验
// 实现：阿贝多
//
// @moved-from projects/solo-flight/src/utils/id.ts
// ============================================================

import type { SkillId, SkillVersion } from '../types.js';

/** ID 校验正则：只允许小写字母、数字、连字符 */
const SKILL_ID_REGEX = /^[a-z][a-z0-9-]{1,63}$/;

/** 版本号校验正则：semver 格式 */
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;

/**
 * 创建一个 SkillId（带运行时校验）
 * @throws 如果 id 格式不合法
 */
export function createSkillId(id: string): SkillId {
  if (!SKILL_ID_REGEX.test(id)) {
    throw new Error(
      `非法技能 ID：「${id}」。ID 必须以小写字母开头，仅含小写字母、数字、连字符，长度 2-64。`
    );
  }
  return id as SkillId;
}

/**
 * 安全创建 SkillId——不抛异常，返回错误信息
 */
export function safeCreateSkillId(id: string): { ok: true; id: SkillId } | { ok: false; error: string } {
  if (!SKILL_ID_REGEX.test(id)) {
    return {
      ok: false,
      error: `非法技能 ID：「${id}」。ID 必须以小写字母开头，仅含小写字母、数字、连字符，长度 2-64。`,
    };
  }
  return { ok: true, id: id as SkillId };
}

/**
 * 创建一个 SkillVersion（带运行时校验）
 * @throws 如果 version 格式不合法
 */
export function createSkillVersion(version: string): SkillVersion {
  if (!SEMVER_REGEX.test(version)) {
    throw new Error(`非法版本号：「${version}」。必须遵循 semver 格式 (x.y.z)。`);
  }
  return version as SkillVersion;
}

/**
 * 安全创建 SkillVersion——不抛异常
 */
export function safeCreateSkillVersion(
  version: string
): { ok: true; version: SkillVersion } | { ok: false; error: string } {
  if (!SEMVER_REGEX.test(version)) {
    return {
      ok: false,
      error: `非法版本号：「${version}」。必须遵循 semver 格式 (x.y.z)。`,
    };
  }
  return { ok: true, version: version as SkillVersion };
}

/** 生成唯一追踪 ID */
export function generateTraceId(): string {
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
