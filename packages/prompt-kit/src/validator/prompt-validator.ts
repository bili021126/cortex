/**
 * @cortex/prompt-kit — Prompt 校验器
 *
 * 校验 PromptTemplate 的完整性和渲染产物的质量。
 * 支持自定义校验规则和段存在性检查。
 *
 * @see DESIGN.md §3.4 PromptValidator
 */

import {
  PromptBlockType,
  type PromptTemplate,
  type PromptResult,
  type ValidationResult,
  type ValidationError,
  type SectionCheckResult,
} from "../types.js";

/**
 * 校验规则定义。
 */
export type ValidationRule = (
  template: PromptTemplate,
  result?: PromptResult,
) => ValidationError | null;

/**
 * PromptValidator — 校验器。
 */
export class PromptValidator {
  private rules: ValidationRule[] = [];

  constructor() {
    // 注册默认校验规则
    this.registerDefaultRules();
  }

  /**
   * 校验模板结构。
   */
  validateTemplate(template: PromptTemplate): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // 1. 必要字段存在
    if (!template.id) {
      errors.push({ path: "id", message: "模板 ID 不能为空", severity: "error" });
    }
    if (!template.name) {
      errors.push({ path: "name", message: "模板名称不能为空", severity: "error" });
    }
    if (!template.version) {
      warnings.push("模板版本号未设置，默认使用 0.1.0");
    }

    // 2. 块检查
    if (!template.blocks || template.blocks.length === 0) {
      errors.push({ path: "blocks", message: "模板至少包含一个语义块", severity: "error" });
    } else {
      // 块 ID 唯一性
      const ids = new Map<string, number>();
      for (const block of template.blocks) {
        const count = ids.get(block.id) ?? 0;
        ids.set(block.id, count + 1);
      }
      for (const [id, count] of ids) {
        if (count > 1) {
          errors.push({
            path: `blocks.${id}`,
            message: `块 ID "${id}" 重复出现 ${count} 次`,
            severity: "error",
          });
        }
      }

      // 至少包含 Identity 或 Persona 块
      const hasIdentity = template.blocks.some(
        (b) => b.type === PromptBlockType.Identity || b.type === PromptBlockType.Persona,
      );
      if (!hasIdentity) {
        warnings.push("模板缺少 Identity 或 Persona 块，可能无法正确建立角色");
      }
    }

    // 3. 执行自定义规则 — 错误级的放入 errors，警告级的放入 warnings
    for (const rule of this.rules) {
      const error = rule(template);
      if (error) {
        if (error.severity === "warning") {
          warnings.push(error.message);
        } else {
          errors.push(error);
        }
      }
    }

    return {
      valid: errors.filter((e) => e.severity === "error").length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 校验渲染结果。
   */
  validateResult(result: PromptResult): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // 渲染结果必须包含文本
    if (!result.text || result.text.trim().length === 0) {
      errors.push({
        path: "text",
        message: "渲染结果为空",
        severity: "error",
      });
    }

    // 检查是否有高优先级的块被跳过
    const criticalSkipped = result.skippedBlocks.filter((sb) => sb.reason === "access_denied");
    for (const skipped of criticalSkipped) {
      warnings.push(`块 "${skipped.id}" 因访问限制被跳过`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 检查必需段是否存在。
   */
  checkRequiredSections(
    result: PromptResult,
    requiredTypes: PromptBlockType[],
  ): SectionCheckResult {
    const renderedTypes = new Set(result.renderedBlocks.map((b) => b.type));
    const missing: PromptBlockType[] = [];
    const warnings: string[] = [];

    for (const type of requiredTypes) {
      if (!renderedTypes.has(type)) {
        missing.push(type);
        warnings.push(`缺少必需的段类型: ${type}`);
      }
    }

    return {
      allPresent: missing.length === 0,
      present: Array.from(renderedTypes).filter((t) => requiredTypes.includes(t)),
      missing,
      warnings,
    };
  }

  /**
   * 注册自定义校验规则。
   */
  registerRule(name: string, rule: ValidationRule): void {
    this.rules.push(rule);
  }

  /**
   * 注册默认校验规则。
   */
  private registerDefaultRules(): void {
    // 规则：检查模板是否包含未闭合的变量引用
    this.registerRule("unclosed-variables", (template) => {
      for (const block of template.blocks) {
        const openCount = (block.content.match(/\{\{/g) || []).length;
        const closeCount = (block.content.match(/\}\}/g) || []).length;
        if (openCount !== closeCount) {
          return {
            path: `blocks.${block.id}`,
            message: `块 "${block.id}" 中存在未闭合的模板语法（开 {{: ${openCount}, 闭 }}: ${closeCount}）`,
            severity: "error",
            code: "UNCLOSED_SYNTAX",
          };
        }
      }
      return null;
    });

    // 规则：检查条件与循环的成对性
    this.registerRule("matching-directives", (template) => {
      for (const block of template.blocks) {
        const content = block.content;
        const ifOpen = (content.match(/\{\{#if\b/g) || []).length;
        const ifClose = (content.match(/\{\{\/if\b/g) || []).length;
        const eachOpen = (content.match(/\{\{#each\b/g) || []).length;
        const eachClose = (content.match(/\{\{\/each\b/g) || []).length;

        if (ifOpen !== ifClose) {
          return {
            path: `blocks.${block.id}`,
            message: `块 "${block.id}" 中 {{#if}} 与 {{/if}} 数量不匹配（开: ${ifOpen}, 闭: ${ifClose}）`,
            severity: "error",
            code: "MISMATCHED_DIRECTIVES",
          };
        }
        if (eachOpen !== eachClose) {
          return {
            path: `blocks.${block.id}`,
            message: `块 "${block.id}" 中 {{#each}} 与 {{/each}} 数量不匹配（开: ${eachOpen}, 闭: ${eachClose}）`,
            severity: "error",
            code: "MISMATCHED_DIRECTIVES",
          };
        }
      }
      return null;
    });

    // 规则：检查 Source 字段
    this.registerRule("source-tracking", (template) => {
      if (!template.source && template.blocks.length > 0) {
        return {
          path: "source",
          message: "模板未标注来源，版本追踪可能不完整",
          severity: "warning",
          code: "MISSING_SOURCE",
        };
      }
      return null;
    });
  }
}
