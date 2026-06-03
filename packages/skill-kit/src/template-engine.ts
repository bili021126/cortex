/**
 * @cortex/skill-kit — 模板引擎
 *
 * 提供模板渲染能力，支持：
 * - 变量插值：{{ variableName }}
 * - 嵌套属性访问：{{ user.name }}
 * - 默认值：{{ variable || defaultValue }}
 * - 条件渲染：{{#if condition}}...{{/if}}
 * - 循环渲染：{{#each list}}...{{/each}}
 * - HTML 转义（可选）
 *
 * 用于技能步骤的 prompt 模板渲染、输出格式化等场景。
 *
 * @see docs/design.md §7 执行管线
 */

import {
  type TemplateEngineOptions,
  type TemplateContext,
} from "./types.js";

// ============================================================
// SimpleTemplateEngine — 轻量模板引擎
// ============================================================

const DEFAULT_OPTIONS: Required<TemplateEngineOptions> = {
  delimiters: ["{{", "}}"],
  undefinedPlaceholder: "",
  escapeHtml: false,
};

/**
 * SimpleTemplateEngine —— 轻量级模板渲染引擎。
 *
 * 支持的语法：
 * - `{{ variable }}` — 变量插值
 * - `{{ user.name }}` — 嵌套属性访问（点号路径）
 * - `{{ variable || fallback }}` — 默认值（左侧为 undefined/null 时使用右侧）
 * - `{{#if condition}}...{{/if}}` — 条件渲染
 * - `{{#each list}}...{{/each}}` — 循环渲染（循环体内可通过 {{ this }} 或 {{ item }} 访问当前元素）
 *
 * 不依赖任何外部模板引擎库。
 */
export class SimpleTemplateEngine {
  private options: Required<TemplateEngineOptions>;
  private openTag: string;
  private closeTag: string;

  constructor(options: TemplateEngineOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    [this.openTag, this.closeTag] = this.options.delimiters;
  }

  /**
   * 渲染模板字符串。
   *
   * @param template 模板字符串
   * @param context  变量上下文
   * @returns 渲染后的字符串
   *
   * @example
   * ```typescript
   * const engine = new SimpleTemplateEngine();
   * const result = engine.render("Hello, {{ name }}!", { name: "World" });
   * // => "Hello, World!"
   * ```
   */
  render(template: string, context: TemplateContext): string {
    if (!template) return "";

    let result = template;

    // 1. 处理条件块 {{#if condition}}...{{/if}}
    result = this.renderConditionals(result, context);

    // 2. 处理循环块 {{#each list}}...{{/each}}
    result = this.renderEach(result, context);

    // 3. 处理变量插值 {{ variable }} 和 {{ variable || fallback }}
    result = this.renderVariables(result, context);

    return result;
  }

  /**
   * 渲染字符串数组模板（每条依次渲染，拼接换行）。
   *
   * @param templates 模板字符串数组
   * @param context   变量上下文
   * @returns 渲染后的字符串数组
   */
  renderEachLine(
    templates: string[],
    context: TemplateContext,
  ): string[] {
    return templates.map((t) => this.render(t, context));
  }

  /**
   * 安全地渲染值——如果启用了 HTML 转义，对输出做转义处理。
   */
  private safeRender(value: unknown): string {
    const str = value === null || value === undefined
      ? this.options.undefinedPlaceholder
      : String(value);

    if (this.options.escapeHtml) {
      return this.escapeHtml(str);
    }
    return str;
  }

  /**
   * HTML 转义。
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ── 变量插值 ──────────────────────────────────────────────

  /**
   * 处理模板中的变量插值。
   * 支持：
   * - {{ variable }}
   * - {{ variable || defaultValue }}
   * - {{ a.b.c }}（嵌套路径）
   */
  private renderVariables(template: string, context: TemplateContext): string {
    // 匹配 {{ expression }}，但不匹配 {{# 和 {{/ 控制标签
    const variableRegex = new RegExp(
      `${this.escapeRegex(this.openTag)}\\s*(?!#|/)([\\s\\S]+?)\\s*${this.escapeRegex(this.closeTag)}`,
      "g",
    );

    return template.replace(variableRegex, (_match, expression: string) => {
      const trimmed = expression.trim();

      // 处理默认值语法：variable || fallback
      const pipeIndex = trimmed.indexOf("||");
      let path: string;
      let fallback: string | undefined;

      if (pipeIndex !== -1) {
        path = trimmed.substring(0, pipeIndex).trim();
        fallback = trimmed.substring(pipeIndex + 2).trim();
      } else {
        path = trimmed;
      }

      // 获取变量值
      const value = this.resolvePath(context, path);

      // 如果值为 undefined/null，使用 fallback
      if (value === undefined || value === null) {
        if (fallback !== undefined) {
          // fallback 可能本身也是变量引用
          const fallbackValue = this.resolvePath(context, fallback);
          return this.safeRender(fallbackValue ?? fallback);
        }
        return this.safeRender(this.options.undefinedPlaceholder);
      }

      // 处理函数调用
      if (typeof value === "function") {
        return this.safeRender(value.call(context));
      }

      return this.safeRender(value);
    });
  }

  // ── 条件渲染 ──────────────────────────────────────────────

  /**
   * 处理条件块 {{#if condition}}...{{/if}}。
   * 支持 {{#if condition}}...{{else}}...{{/if}}。
   */
  private renderConditionals(template: string, context: TemplateContext): string {
    const ifRegex = new RegExp(
      `${this.escapeRegex(this.openTag)}\\s*#if\\s+(.+?)\\s*${this.escapeRegex(this.closeTag)}([\\s\\S]*?)${this.escapeRegex(this.openTag)}\\s*/if\\s*${this.escapeRegex(this.closeTag)}`,
      "g",
    );

    return template.replace(ifRegex, (_match, condition: string, body: string) => {
      const conditionValue = this.evaluateCondition(condition.trim(), context);

      // 处理 {{else}} 分支
      const elseIndex = body.search(
        new RegExp(
          `${this.escapeRegex(this.openTag)}\\s*else\\s*${this.escapeRegex(this.closeTag)}`,
        ),
      );

      let trueBody: string;
      let falseBody: string;

      if (elseIndex !== -1) {
        trueBody = body.substring(0, elseIndex);
        falseBody = body.substring(
          elseIndex +
            body.substring(elseIndex).search(
              new RegExp(
                `${this.escapeRegex(this.closeTag)}`,
              ),
            ) +
            1,
        );
        // 更精确的 else 分割
        const elseMatch = body.match(
          new RegExp(
            `${this.escapeRegex(this.openTag)}\\s*else\\s*${this.escapeRegex(this.closeTag)}([\\s\\S]*)`,
          ),
        );
        if (elseMatch) {
          trueBody = body.substring(0, body.indexOf(this.openTag + "else" + this.closeTag));
          falseBody = elseMatch[1];
        }
      } else {
        trueBody = body;
        falseBody = "";
      }

      const selectedBody = conditionValue ? trueBody : falseBody;

      // 递归渲染所选分支（支持嵌套条件）
      return this.render(selectedBody, context);
    });
  }

  /**
   * 评估条件表达式。
   * 支持：变量名、嵌套路径、取反 ! 前缀。
   */
  private evaluateCondition(condition: string, context: TemplateContext): boolean {
    let expr = condition.trim();

    // 取反
    const isNegated = expr.startsWith("!");
    if (isNegated) {
      expr = expr.substring(1).trim();
    }

    // 字面量布尔值
    if (expr === "true") return !isNegated;
    if (expr === "false") return isNegated;

    // 解析变量值
    const value = this.resolvePath(context, expr);

    // 假值判断
    const isTruthy = value !== undefined && value !== null && value !== false && value !== 0 && value !== "";

    return isNegated ? !isTruthy : isTruthy;
  }

  // ── 循环渲染 ──────────────────────────────────────────────

  /**
   * 处理循环块 {{#each list}}...{{/each}}。
   * 循环体内支持：
   * - {{ this }} — 当前元素
   * - {{ index }} — 当前索引（从 0 开始）
   * - {{ key }} — 当前键（对象迭代时）
   * - 变量访问自动降级到父上下文
   */
  private renderEach(template: string, context: TemplateContext): string {
    const eachRegex = new RegExp(
      `${this.escapeRegex(this.openTag)}\\s*#each\\s+(.+?)\\s*${this.escapeRegex(this.closeTag)}([\\s\\S]*?)${this.escapeRegex(this.openTag)}\\s*/each\\s*${this.escapeRegex(this.closeTag)}`,
      "g",
    );

    return template.replace(eachRegex, (_match, listExpr: string, body: string) => {
      const list = this.resolvePath(context, listExpr.trim());

      if (!Array.isArray(list) && (typeof list !== "object" || list === null)) {
        return "";
      }

      const parts: string[] = [];

      if (Array.isArray(list)) {
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          const itemContext: TemplateContext = {
            ...context,
            this: item,
            index: i,
            key: String(i),
          };
          parts.push(this.render(body, itemContext));
        }
      } else {
        // 对象迭代
        const keys = Object.keys(list as Record<string, unknown>);
        for (const key of keys) {
          const item = (list as Record<string, unknown>)[key];
          const itemContext: TemplateContext = {
            ...context,
            this: item,
            key,
            index: keys.indexOf(key),
          };
          parts.push(this.render(body, itemContext));
        }
      }

      return parts.join("");
    });
  }

  // ── 路径解析 ──────────────────────────────────────────────

  /**
   * 按点号路径解析上下文中的值。
   *
   * @example
   * resolvePath({ user: { name: "Alice" } }, "user.name") => "Alice"
   * resolvePath({ items: [1,2] }, "items.0") => 1
   */
  private resolvePath(context: TemplateContext, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = context;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      if (typeof current === "object" && part in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  // ── 工具方法 ──────────────────────────────────────────────

  /**
   * 转义正则表达式特殊字符。
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
