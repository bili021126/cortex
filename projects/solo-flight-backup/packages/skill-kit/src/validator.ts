// ============================================================================
// @cortex/skill-kit — Validator
//
// Validates SkillDefinition correctness and completeness using composable
// rules.  Ships with 8 built-in rules, extensible via registerRule().
// ============================================================================

import type {
  SkillDefinition,
  ValidationEntry,
  ValidationResult,
  ValidationRule,
  ValidatorOptions,
  ValidationLevel,
} from './types.js';

// ─── Built-in Rules ────────────────────────────────────────────────────────

/**
 * 规则: required-fields — 检查必填字段是否存在。
 */
class RequiredFieldsRule implements ValidationRule {
  readonly id = 'required-fields';
  readonly description = 'Check that required fields (id, name, description, agentTypes, triggerTags, version) exist';

  validate(skill: SkillDefinition): ValidationEntry[] {
    const entries: ValidationEntry[] = [];
    const requiredFields: [string, unknown][] = [
      ['id', skill.id],
      ['name', skill.name],
      ['description', skill.description],
      ['agentTypes', skill.agentTypes],
      ['triggerTags', skill.triggerTags],
      ['version', skill.version],
    ];

    for (const [field, value] of requiredFields) {
      if (value === undefined || value === null || value === '') {
        entries.push({
          level: 'error',
          code: 'required-fields',
          message: `Missing required field: "${field}"`,
          skillId: skill.id,
          path: field,
          suggestion: `Add a "${field}" field to the skill definition`,
        });
      }
    }
    return entries;
  }
}

/**
 * 规则: id-format — 检查 ID 格式。
 */
class IdFormatRule implements ValidationRule {
  readonly id = 'id-format';
  readonly description = 'Check that skill ID matches skill-[a-z0-9]+(-[a-z0-9]+)*';

  // Matches: skill-foo, skill-foo-bar, skill-analyze-package, etc.
  // Rejects: Skill-foo, skill-Foo, skill_foo, etc.
  private readonly ID_PATTERN = /^skill-[a-z0-9]+(-[a-z0-9]+)*$/;

  validate(skill: SkillDefinition): ValidationEntry[] {
    if (!skill.id) return []; // will be caught by required-fields
    if (!this.ID_PATTERN.test(skill.id)) {
      return [{
        level: 'error',
        code: 'id-format',
        message: `Skill ID "${skill.id}" does not match pattern: skill-[a-z0-9]+(-[a-z0-9]+)*`,
        skillId: skill.id,
        path: 'id',
        suggestion: `Rename to: skill-${skill.id.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`,
      }];
    }
    return [];
  }
}

/**
 * 规则: trigger-tags — 检查 triggerTags 长度。
 */
class TriggerTagsRule implements ValidationRule {
  readonly id = 'trigger-tags';
  readonly description = 'Check that triggerTags has at least one entry';

  validate(skill: SkillDefinition): ValidationEntry[] {
    if (!skill.triggerTags || skill.triggerTags.length === 0) {
      return [{
        level: 'warn',
        code: 'trigger-tags',
        message: `Skill "${skill.id}" has no trigger tags; it will never be auto-matched`,
        skillId: skill.id,
        path: 'triggerTags',
        suggestion: 'Add at least one trigger tag, e.g. ["refactor", "analyze"]',
      }];
    }
    return [];
  }
}

/**
 * 规则: agent-types — 检查 agentTypes 引用。
 */
class AgentTypesRule implements ValidationRule {
  readonly id = 'agent-types';
  readonly description = 'Check that agentTypes references known agent types';

  // Known agent types — extendable via constructor option in the future
  private readonly KNOWN_TYPES = new Set([
    'code', 'architect', 'reviewer', 'devops',
    'documentation', 'testing', 'project-manager',
    'meta-agent', 'skill-creator',
  ]);

  validate(skill: SkillDefinition): ValidationEntry[] {
    const entries: ValidationEntry[] = [];

    if (!skill.agentTypes || skill.agentTypes.length === 0) {
      entries.push({
        level: 'warn',
        code: 'agent-types',
        message: `Skill "${skill.id}" has no agent types defined`,
        skillId: skill.id,
        path: 'agentTypes',
        suggestion: 'Specify which agent types can use this skill, e.g. ["code", "architect"]',
      });
      return entries;
    }

    for (const agentType of skill.agentTypes) {
      if (!this.KNOWN_TYPES.has(agentType)) {
        entries.push({
          level: 'warn',
          code: 'agent-types',
          message: `Agent type "${agentType}" in skill "${skill.id}" is not in the known types list`,
          skillId: skill.id,
          path: `agentTypes[${skill.agentTypes.indexOf(agentType)}]`,
          suggestion: `Use one of: ${Array.from(this.KNOWN_TYPES).join(', ')}`,
        });
      }
    }

    return entries;
  }
}

/**
 * 规则: version-format — 检查版本号是否符合 semver。
 */
class VersionFormatRule implements ValidationRule {
  readonly id = 'version-format';
  readonly description = 'Check that version follows semver format (MAJOR.MINOR.PATCH)';

  private readonly SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;

  validate(skill: SkillDefinition): ValidationEntry[] {
    if (!skill.version) return [];
    if (!this.SEMVER_RE.test(skill.version)) {
      return [{
        level: 'error',
        code: 'version-format',
        message: `Version "${skill.version}" is not a valid semver (expected MAJOR.MINOR.PATCH)`,
        skillId: skill.id,
        path: 'version',
        suggestion: 'Use format like "1.0.0" or "0.1.0-beta.1"',
      }];
    }
    return [];
  }
}

/**
 * 规则: execute-exists — 检查 execute 方法是否存在且为函数。
 */
class ExecuteExistsRule implements ValidationRule {
  readonly id = 'execute-exists';
  readonly description = 'Check that the execute method is a function';

  validate(skill: SkillDefinition): ValidationEntry[] {
    if (typeof skill.execute !== 'function') {
      return [{
        level: 'error',
        code: 'execute-exists',
        message: `Skill "${skill.id}" has no execute() method`,
        skillId: skill.id,
        path: 'execute',
        suggestion: 'Add an async execute(ctx) method that returns ExecutionResult',
      }];
    }
    return [];
  }
}

/**
 * 规则: no-side-effects-export — 检查副作用导出（占位规则）。
 */
class NoSideEffectsExportRule implements ValidationRule {
  readonly id = 'no-side-effects-export';
  readonly description = 'Warn if the module appears to have top-level side effects';

  validate(_skill: SkillDefinition): ValidationEntry[] {
    // This rule is intended for static analysis of the module file.
    // In runtime, we can't reliably detect side effects, so this is a no-op.
    // Real implementation would inspect the source AST.
    return [];
  }
}

/**
 * 规则: context-file-exists — 检查上下文文件 glob 模式（占位规则）。
 */
class ContextFileExistsRule implements ValidationRule {
  readonly id = 'context-file-exists';
  readonly description = 'Check that requiredContextFiles globs reference existing files';

  validate(skill: SkillDefinition): ValidationEntry[] {
    if (!skill.requiredContextFiles || skill.requiredContextFiles.length === 0) {
      return [];
    }

    // Runtime check of glob patterns would require filesystem access.
    // This is a best-effort warning for now.
    const entries: ValidationEntry[] = [];
    for (const pattern of skill.requiredContextFiles) {
      if (typeof pattern !== 'string' || pattern.trim() === '') {
        entries.push({
          level: 'warn',
          code: 'context-file-exists',
          message: `Invalid requiredContextFiles pattern in skill "${skill.id}"`,
          skillId: skill.id,
          path: 'requiredContextFiles',
          suggestion: 'Each pattern should be a non-empty glob string like "src/**/*.ts"',
        });
      }
    }
    return entries;
  }
}

// ─── Validator ─────────────────────────────────────────────────────────────

/**
 * Validator —— 技能定义校验器。
 *
 * 支持：
 * - 8 个内置规则（必填字段、ID 格式、标签格式等）
 * - 自定义规则（通过 registerRule）
 * - 忽略特定规则（通过 options）
 */
export class Validator {
  private readonly rules: Map<string, ValidationRule> = new Map();

  constructor(private readonly options: ValidatorOptions = {}) {
    this.registerBuiltinRules();
  }

  // ─── 公开 API ───────────────────────────────────

  /**
   * 校验单个技能定义。
   */
  validate(skill: SkillDefinition): ValidationResult {
    const entries: ValidationEntry[] = [];
    for (const [id, rule] of this.rules) {
      if (this.options.ignoredRules?.includes(id)) continue;
      entries.push(...rule.validate(skill));
    }
    return this.toResult(entries);
  }

  /**
   * 批量校验多个技能。
   */
  validateAll(skills: SkillDefinition[]): Map<string, ValidationResult> {
    const results = new Map<string, ValidationResult>();
    for (const skill of skills) {
      results.set(skill.id, this.validate(skill));
    }
    return results;
  }

  /**
   * 注册自定义校验规则。
   */
  registerRule(rule: ValidationRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * 移除校验规则。
   */
  unregisterRule(id: string): void {
    this.rules.delete(id);
  }

  // ─── 内置规则 ───────────────────────────────────

  private registerBuiltinRules(): void {
    const rules: ValidationRule[] = [
      new RequiredFieldsRule(),
      new IdFormatRule(),
      new TriggerTagsRule(),
      new AgentTypesRule(),
      new VersionFormatRule(),
      new ExecuteExistsRule(),
      new NoSideEffectsExportRule(),
      new ContextFileExistsRule(),
    ];

    for (const rule of rules) {
      this.rules.set(rule.id, rule);
    }
  }

  private toResult(entries: ValidationEntry[]): ValidationResult {
    const errorCount = entries.filter((e) => e.level === 'error').length;
    const warnCount = entries.filter((e) => e.level === 'warn').length;

    let valid = errorCount === 0;
    if (this.options.strictMode && warnCount > 0) {
      valid = false;
    }

    return { valid, entries, errorCount, warnCount };
  }
}
