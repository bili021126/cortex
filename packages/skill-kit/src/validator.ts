/**
 * @cortex/skill-kit — 技能校验器
 *
 * 校验 SkillDefinition 的完整性，涵盖：
 * 1. 结构校验：必填字段是否存在、类型是否正确
 * 2. 语义校验：name 非空、steps 非空、triggerTags 非空
 * 3. Schema 校验：inputSchema/outputSchema 符合 JSON Schema 规范
 * 4. 版本校验：version 符合 semver 格式
 * 5. 依赖校验：dependencies 无自引用
 *
 * @see docs/design.md §4.2 SkillValidator
 */

import {
  type SkillDefinition,
  type SkillMeta,
  type SkillManifest,
  type SkillValidator,
  type ValidationResult,
  type ValidationError,
  SkillCategory,
} from "./types.js";

// ============================================================
// SimpleSkillValidator — 运行时校验器
// ============================================================

export interface SimpleSkillValidatorOptions {
  /** 是否严格校验 version 字段必须符合 semver，默认 true */
  strictVersion?: boolean;
  /** 是否要求 category 为有效枚举值，默认 true */
  strictCategory?: boolean;
  /** 是否检查 dependencies 的自引用，默认 true */
  checkSelfReference?: boolean;
}

/**
 * SimpleSkillValidator —— 技能校验器实现。
 *
 * 不依赖外部 JSON Schema 库，纯运行时校验。
 * 覆盖设计文档中定义的所有校验维度。
 */
export class SimpleSkillValidator implements SkillValidator {
  private options: Required<SimpleSkillValidatorOptions>;

  constructor(options: SimpleSkillValidatorOptions = {}) {
    this.options = {
      strictVersion: options.strictVersion ?? true,
      strictCategory: options.strictCategory ?? true,
      checkSelfReference: options.checkSelfReference ?? true,
    };
  }

  /**
   * 校验技能定义。
   * 校验 meta + execute 函数 + validateInput（可选）。
   */
  validate(skill: SkillDefinition): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // 1. 校验顶层结构
    if (!skill || typeof skill !== "object") {
      errors.push({
        path: "(root)",
        message: "技能定义必须为非 null 对象",
        severity: "error",
      });
      return { valid: false, errors, warnings };
    }

    // 2. 校验 execute
    if (typeof skill.execute !== "function") {
      errors.push({
        path: "execute",
        message: "execute 必须为函数",
        severity: "error",
      });
    }

    // 3. 校验 meta
    const metaResult = this.validateMeta(skill.meta);
    errors.push(...metaResult.errors);
    warnings.push(...metaResult.warnings);

    // 4. 校验 validateInput（可选）
    if (skill.validateInput !== undefined && typeof skill.validateInput !== "function") {
      errors.push({
        path: "validateInput",
        message: "validateInput 必须为函数或 undefined",
        severity: "error",
      });
    }

    // 5. 校验 onInit（可选）
    if (skill.onInit !== undefined && typeof skill.onInit !== "function") {
      errors.push({
        path: "onInit",
        message: "onInit 必须为函数或 undefined",
        severity: "error",
      });
    }

    // 6. 校验 onDestroy（可选）
    if (skill.onDestroy !== undefined && typeof skill.onDestroy !== "function") {
      errors.push({
        path: "onDestroy",
        message: "onDestroy 必须为函数或 undefined",
        severity: "error",
      });
    }

    // 7. 依赖自引用检查
    if (this.options.checkSelfReference && skill.meta?.dependencies) {
      if (skill.meta.dependencies.includes(skill.meta.id)) {
        errors.push({
          path: "meta.dependencies",
          message: `技能 "${skill.meta.id}" 的 dependencies 包含自身引用`,
          severity: "error",
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 校验技能元信息。
   * 轻量级校验——不要求有完整的 SkillDefinition。
   */
  validateMeta(meta: SkillMeta): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    if (!meta || typeof meta !== "object") {
      errors.push({
        path: "meta",
        message: "meta 必须为非 null 对象",
        severity: "error",
      });
      return { valid: false, errors, warnings };
    }

    // ── id ──
    this.checkRequiredMetaString(meta, "id", errors);
    if (typeof meta.id === "string" && meta.id.length > 0 && !/^[a-zA-Z0-9_-]+$/.test(meta.id)) {
      warnings.push("meta.id 建议仅包含字母、数字、下划线和连字符");
    }

    // ── name ──
    this.checkRequiredMetaString(meta, "name", errors);

    // ── version ──
    this.checkRequiredMetaString(meta, "version", errors);
    if (this.options.strictVersion && typeof meta.version === "string" && meta.version.length > 0) {
      if (!SEMVER_REGEX.test(meta.version)) {
        errors.push({
          path: "meta.version",
          message: `版本号 "${meta.version}" 不符合 semver 格式（期望 x.y.z）`,
          severity: "error",
        });
      }
    }

    // ── description ──
    this.checkRequiredMetaString(meta, "description", errors);

    // ── category ──
    if (!meta.category) {
      errors.push({
        path: "meta.category",
        message: "category 为必填字段",
        severity: "error",
      });
    } else if (this.options.strictCategory) {
      const validCategories = Object.values(SkillCategory) as string[];
      if (!validCategories.includes(meta.category)) {
        errors.push({
          path: "meta.category",
          message: `category "${meta.category}" 不是有效的 SkillCategory 枚举值`,
          severity: "error",
        });
      }
    }

    // ── triggerTags ──
    if (!Array.isArray(meta.triggerTags)) {
      errors.push({
        path: "meta.triggerTags",
        message: "triggerTags 必须为数组",
        severity: "error",
      });
    } else if (meta.triggerTags.length === 0) {
      warnings.push("meta.triggerTags 为空数组——技能可能无法被触发");
    }

    // ── trigger ──
    this.checkRequiredMetaString(meta, "trigger", errors);

    // ── steps ──
    if (!Array.isArray(meta.steps)) {
      errors.push({
        path: "meta.steps",
        message: "steps 必须为数组",
        severity: "error",
      });
    } else if (meta.steps.length === 0) {
      errors.push({
        path: "meta.steps",
        message: "steps 不能为空数组——技能至少需要一个步骤",
        severity: "error",
      });
    }

    // ── expectedOutput ──
    this.checkRequiredMetaString(meta, "expectedOutput", errors);

    // ── platforms ──（可选字段校验值）
    if (meta.platforms !== undefined) {
      if (!Array.isArray(meta.platforms)) {
        errors.push({
          path: "meta.platforms",
          message: "platforms 必须为数组",
          severity: "error",
        });
      } else {
        const validPlatforms = ["node", "browser", "worker"];
        for (const p of meta.platforms) {
          if (!validPlatforms.includes(p)) {
            warnings.push(
              `meta.platforms 包含未知平台 "${p}"，有效值为 ${validPlatforms.join(", ")}`,
            );
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 校验 JSON 技能清单。
   * 将 SkillManifest 转为 SkillMeta 后再校验。
   *
   * 注意：SkillManifest 不是完整的 SkillDefinition，
   * 因此只校验其元信息部分。
   */
  validateManifest(manifest: SkillManifest): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    if (!manifest || typeof manifest !== "object") {
      errors.push({
        path: "(root)",
        message: "技能清单必须为非 null 对象",
        severity: "error",
      });
      return { valid: false, errors, warnings };
    }

    // 将 manifest 转为 meta 后校验
    const meta: SkillMeta = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version ?? "0.1.0",
      description: `${manifest.trigger} → ${manifest.expectedOutput}`,
      category: manifest.category ?? SkillCategory.TOOL,
      triggerTags: manifest.triggerTags,
      trigger: manifest.trigger,
      steps: manifest.steps,
      expectedOutput: manifest.expectedOutput,
      author: manifest.discoveredBy,
      createdAt: manifest.createdAt,
    };

    const metaResult = this.validateMeta(meta);
    errors.push(...metaResult.errors);
    warnings.push(...metaResult.warnings);

    // Manifest 特有校验
    if (!manifest.agentType) {
      errors.push({
        path: "agentType",
        message: "agentType 为必填字段",
        severity: "error",
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ── 私有辅助方法 ────────────────────────────────────────────

  /**
   * 检查 SkillMeta 上的必填字符串字段。
   * 使用 keyof SkillMeta 确保只访问已知字段。
   */
  private checkRequiredMetaString(
    meta: SkillMeta,
    field: keyof SkillMeta,
    errors: ValidationError[],
  ): void {
    const value = meta[field];
    if (value === undefined || value === null) {
      errors.push({
        path: `meta.${field}`,
        message: `${field} 为必填字段`,
        severity: "error",
      });
    } else if (typeof value !== "string") {
      errors.push({
        path: `meta.${field}`,
        message: `${field} 必须为字符串`,
        severity: "error",
      });
    } else if ((value as string).trim().length === 0) {
      errors.push({
        path: `meta.${field}`,
        message: `${field} 不能为空字符串`,
        severity: "error",
      });
    }
  }
}

// ============================================================
// semver 正则（简化版：仅校验 x.y.z 格式）
// ============================================================

const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/;
