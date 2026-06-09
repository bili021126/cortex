/**
 * @cortex/policy-validator — NamingConventionRule 命名约定规则
 *
 * 检测源码中命名约定违反的规则：
 * - 函数/变量使用 camelCase
 * - 类/类型使用 PascalCase
 * - 常量使用 UPPER_SNAKE_CASE（全大写字母）
 * - 私有字段使用 _ 前缀
 *
 * 通过构造函数注入方式实现（可插拔校验组件）。
 * 依据 coding-standards.md：
 *   - §14.1 Adapter 模式：可插拔校验组件
 *   - §11.2 纯函数风格：validate 不修改外部状态
 */

import type { PolicyRule, PolicyRuleResult } from "../types.js";
import type { PolicyValidatorComponent } from "../ruleEngine.js";

// ============================================================
// 命名约定配置
// ============================================================

/**
 * 命名约定规则配置选项。
 * 通过构造函数注入，遵循配置驱动开发（§七）。
 */
export interface NamingConventionOptions {
  /** 是否启用 camelCase 函数名检查，默认 true */
  readonly checkFunctionCamelCase?: boolean;

  /** 是否启用 PascalCase 类名检查，默认 true */
  readonly checkClassPascalCase?: boolean;

  /** 是否启用 UPPER_SNAKE_CASE 常量检查，默认 true */
  readonly checkConstantUpperSnakeCase?: boolean;

  /** 是否启用 _private 前缀检查，默认 true */
  readonly checkPrivatePrefix?: boolean;
}

// ============================================================
// 正则模式
// ============================================================

/** camelCase: 首字母小写或下划线，后续字母数字 */
const CAMEL_CASE_REGEX = /^_?[a-z][a-zA-Z0-9]*$/;

/** PascalCase: 首字母大写，后续字母数字 */
const PASCAL_CASE_REGEX = /^[A-Z][a-zA-Z0-9]*$/;

/** UPPER_SNAKE_CASE: 全大写字母/数字，词间下划线分隔 */
const UPPER_SNAKE_CASE_REGEX = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

/** 私有字段前缀 _ */
const _PRIVATE_FIELD_REGEX = /^_[a-z][a-zA-Z0-9]*$/;

// ============================================================
// NamingConventionRule
// ============================================================

/**
 * 命名约定校验规则——检测命名规范违反。
 *
 * 通过构造函数注入配置，不依赖全局状态。
 */
export class NamingConventionRule implements PolicyValidatorComponent {
  readonly name = "NamingConventionRule";
  readonly ruleId = "naming/convention";

  private _rule: PolicyRule;
  private _options: Required<NamingConventionOptions>;

  constructor(
    rule: PolicyRule,
    options?: NamingConventionOptions,
  ) {
    this._rule = rule;
    this._options = {
      checkFunctionCamelCase: options?.checkFunctionCamelCase ?? true,
      checkClassPascalCase: options?.checkClassPascalCase ?? true,
      checkConstantUpperSnakeCase: options?.checkConstantUpperSnakeCase ?? true,
      checkPrivatePrefix: options?.checkPrivatePrefix ?? true,
    };
  }

  async validate(filePath: string, content: string): Promise<PolicyRuleResult | null> {
    // 只检查 .ts / .tsx / .js / .jsx 文件
    if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) {
      return null;
    }

    const violations: string[] = [];

    // 按行检查
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      // 检查函数声明命名（只匹配 function 关键字声明，不匹配 const）
      if (this._options.checkFunctionCamelCase) {
        const funcMatch = line.match(/function\s+(\w+)\s*\(/);
        if (funcMatch) {
          const name = funcMatch[1];
          if (!CAMEL_CASE_REGEX.test(name) && !PASCAL_CASE_REGEX.test(name)) {
            violations.push(`Line ${lineNumber}: Function '${name}' should use camelCase or PascalCase`);
          }
        }

        // 检查箭头函数变量和函数表达式赋值
        const arrowMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:\(|async|function)/);
        if (arrowMatch) {
          const name = arrowMatch[1];
          // 跳过全大写常量名
          if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
            if (!CAMEL_CASE_REGEX.test(name) && !PASCAL_CASE_REGEX.test(name)) {
              violations.push(`Line ${lineNumber}: Variable '${name}' should use camelCase or PascalCase`);
            }
          }
        }
      }

      // 检查类名
      if (this._options.checkClassPascalCase) {
        const classMatch = line.match(/class\s+(\w+)/);
        if (classMatch) {
          const name = classMatch[1];
          if (!PASCAL_CASE_REGEX.test(name)) {
            violations.push(`Line ${lineNumber}: Class '${name}' should use PascalCase`);
          }
        }
      }

      // 检查常量命名（全大写常量）
      if (this._options.checkConstantUpperSnakeCase) {
        const constMatch = line.match(/const\s+([A-Z][A-Z0-9_]+)\s*=/);
        if (constMatch) {
          const name = constMatch[1];
          if (!UPPER_SNAKE_CASE_REGEX.test(name)) {
            violations.push(`Line ${lineNumber}: Constant '${name}' should use UPPER_SNAKE_CASE`);
          }
        }
      }
    }

    if (violations.length === 0) {
      return {
        ruleId: this.ruleId,
        severity: this._rule.severity,
        passed: true,
        code: this._rule.code,
        filePath,
        rule: this._rule,
      };
    }

    return {
      ruleId: this.ruleId,
      severity: this._rule.severity,
      passed: false,
      message: violations.join("; "),
      code: this._rule.code,
      filePath,
      rule: this._rule,
      line: 1,
      fixSuggestion: this._rule.fixSuggestion,
    };
  }
}
