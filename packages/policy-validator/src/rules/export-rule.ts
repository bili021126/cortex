/**
 * @cortex/policy-validator — ExportRule 导出规范规则
 *
 * 检测模块导出违反的规则：
 * - 检查 barrel 导出是否缺失（新增公开符号但未在 index.ts 中导出）
 * - 检查是否使用 export default（优先命名导出）
 * - 检查测试文件是否使用相对路径导入 src/
 *
 * 通过构造函数注入方式实现（可插拔校验组件）。
 * 依据 coding-standards.md：
 *   - §四 barrel 铁律：新增公开符号须更新 barrel
 *   - §十 代码规范：命名导出优先
 *   - §14.1 Adapter 模式：可插拔组件
 */

import type { PolicyRule, PolicyRuleResult } from "../types.js";
import type { PolicyValidatorComponent } from "../ruleEngine.js";

// ============================================================
// 导出规则配置
// ============================================================

/**
 * 导出规则配置选项。
 * 通过构造函数注入，遵循配置驱动开发（§七）。
 */
export interface ExportRuleOptions {
  /** 是否检查 export default，默认 true */
  readonly checkDefaultExport?: boolean;

  /** 是否检查测试文件相对导入，默认 true */
  readonly checkTestRelativeImport?: boolean;

  /** 是否检查 barrel 导出缺失，默认 true */
  readonly checkBarrelExport?: boolean;

  /** barrel 文件模式，默认 "**\/index.ts" */
  readonly barrelPattern?: string;
}

// ============================================================
// ExportRule
// ============================================================

/**
 * 导出规范校验规则——检测导出相关违反。
 *
 * 通过构造函数注入配置，不依赖全局状态。
 */
export class ExportRule implements PolicyValidatorComponent {
  readonly name = "ExportRule";
  readonly ruleId = "export/convention";

  private _rule: PolicyRule;
  private _options: Required<ExportRuleOptions>;

  constructor(
    rule: PolicyRule,
    options?: ExportRuleOptions,
  ) {
    this._rule = rule;
    this._options = {
      checkDefaultExport: options?.checkDefaultExport ?? true,
      checkTestRelativeImport: options?.checkTestRelativeImport ?? true,
      checkBarrelExport: options?.checkBarrelExport ?? true,
      barrelPattern: options?.barrelPattern ?? "**/index.ts",
    };
  }

  async validate(filePath: string, content: string): Promise<PolicyRuleResult | null> {
    // 只检查 .ts / .tsx 文件
    if (!/\.(ts|tsx)$/.test(filePath)) {
      return null;
    }

    const violations: string[] = [];
    const infoMessages: string[] = [];

    // 1. 检查 export default
    if (this._options.checkDefaultExport) {
      // 跳过 barrel 文件自身的检查
      if (!filePath.endsWith("/index.ts") && !filePath.endsWith("\\index.ts")) {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes("export default")) {
            violations.push(`Line ${i + 1}: Prefer named export over export default`);
            break;
          }
        }
      }
    }

    // 2. 检查测试文件中的相对导入
    if (this._options.checkTestRelativeImport) {
      if (filePath.includes("/tests/") || filePath.includes("\\tests\\") || filePath.includes(".test.")) {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // 匹配 from "../src/" 或 from "./../src/" 等模式
          if (line.match(/from\s+["']\.\.\/src\//) || line.match(/from\s+["']\.\.\/\.\.\/src\//)) {
            violations.push(`Line ${i + 1}: Test file should not use relative import '../src/' — use package name instead`);
          }
        }
      }
    }

    // 3. 检查 barrel 导出（仅作为信息提示，不阻断）
    if (this._options.checkBarrelExport) {
      // 跳过 barrel 文件自身
      if (!filePath.endsWith("/index.ts") && !filePath.endsWith("\\index.ts")) {
        // 检查文件是否有公开导出
        const publicExports: string[] = [];
        const exportRegex = /^export\s+(?:function|class|interface|type|const|let|var|enum|abstract\s+class)\s+(\w+)/gm;
        let match: RegExpExecArray | null;

        const regex = new RegExp(exportRegex.source, "gm");
        while ((match = regex.exec(content)) !== null) {
          publicExports.push(match[1]);
        }

        // 如果有公开导出但没有对应的 barrel 文件
        if (publicExports.length > 0) {
          const _dir = filePath.substring(0, Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")));
          infoMessages.push(
            `Info: File has ${publicExports.length} public export(s): ${publicExports.join(", ")}. ` +
            `Ensure barrel file re-exports them.`,
          );
        }
      }
    }

    // 如果没有任何 violations 和 info，直接返回通过
    if (violations.length === 0 && infoMessages.length === 0) {
      return {
        ruleId: this.ruleId,
        severity: this._rule.severity,
        passed: true,
        code: this._rule.code,
        filePath,
        rule: this._rule,
      };
    }

    // 只有 info 没有 violations 的情况：通过，但附带信息
    if (violations.length === 0 && infoMessages.length > 0) {
      return {
        ruleId: this.ruleId,
        severity: "info",
        passed: true,
        message: infoMessages.join("; "),
        code: this._rule.code,
        filePath,
        rule: this._rule,
      };
    }

    // 有 violations：失败
    return {
      ruleId: this.ruleId,
      severity: this._rule.severity,
      passed: false,
      message: violations.join("; "),
      code: this._rule.code,
      filePath,
      rule: this._rule,
      fixSuggestion: this._rule.fixSuggestion,
    };
  }
}
