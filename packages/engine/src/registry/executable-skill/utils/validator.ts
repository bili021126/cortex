// ============================================================
// 🌿 Cortex 技能注册表 — 校验工具
// 实现：阿贝多
//
// @moved-from projects/solo-flight/src/utils/validator.ts
// ============================================================

import type { SkillMeta } from '../types.js';

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * 校验技能元信息完整性
 * 返回所有校验错误，空数组表示校验通过
 */
export function validateSkillMeta(meta: Partial<SkillMeta>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!meta.id || typeof meta.id !== 'string') {
    errors.push({ field: 'id', message: '技能 ID 是必填项' });
  }

  if (!meta.name || typeof meta.name !== 'string' || meta.name.trim().length === 0) {
    errors.push({ field: 'name', message: '技能名称是必填项' });
  }

  if (!meta.version || typeof meta.version !== 'string') {
    errors.push({ field: 'version', message: '技能版本是必填项' });
  } else if (!/^\d+\.\d+\.\d+/.test(meta.version)) {
    errors.push({ field: 'version', message: `版本号「${meta.version}」不是合法的 semver 格式` });
  }

  if (!meta.description || typeof meta.description !== 'string') {
    errors.push({ field: 'description', message: '技能描述是必填项' });
  }

  if (!Array.isArray(meta.tags)) {
    errors.push({ field: 'tags', message: '标签必须为数组' });
  }

  if (!Array.isArray(meta.dependencies)) {
    errors.push({ field: 'dependencies', message: '依赖列表必须为数组' });
  }

  if (meta.category !== undefined && !isValidCategory(meta.category)) {
    errors.push({ field: 'category', message: `无效的技能分类「${meta.category}」` });
  }

  return errors;
}

/** 检查分类是否合法 */
function isValidCategory(category: string): boolean {
  const validCategories: string[] = [
    'data', 'nlp', 'tool', 'reasoning', 'memory', 'communication', 'system',
  ];
  return validCategories.includes(category);
}

/** 格式化校验错误为可读字符串 */
export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return '';
  return errors.map((e) => `  • ${e.field}: ${e.message}`).join('\n');
}
