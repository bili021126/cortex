// ============================================================
// skill-template-engine.ts —— 技能步骤模板渲染引擎
//
// 从 @cortex/skill-kit 迁移而来，纳入 engine 组件管线。
// 提供轻量级模板渲染能力，用于技能步骤的 prompt 模板渲染。
//
// 支持的语法：
// - {{ variable }} — 变量插值
// - {{ user.name }} — 嵌套属性访问（点号路径）
// - {{ variable || fallback }} — 默认值
// - {{#if condition}}...{{/if}} — 条件渲染（支持 {{else}} 分支）
// - {{#each list}}...{{/each}} — 循环渲染
//
// 不依赖任何外部模板引擎库。
//
// @merged-from @cortex/skill-kit/src/template-engine.ts
// ============================================================

/** 模板引擎配置选项 */
export interface TemplateEngineOptions {
  /** 变量插值分隔符，默认 ["{{", "}}"] */
  delimiters?: [string, string];
  /** 未定义变量时的默认值，默认 "" */
  undefinedPlaceholder?: string;
  /** 是否启用 HTML 转义，默认 false */
  escapeHtml?: boolean;
}

/** 模板上下文——传递给模板引擎的变量和辅助函数 */
export interface TemplateContext {
  [key: string]: unknown;
}

const DEFAULT_OPTIONS: Required<TemplateEngineOptions> = {
  delimiters: ["{{", "}}"],
  undefinedPlaceholder: "",
  escapeHtml: false,
};

/**
 * SkillTemplateEngine —— 轻量级模板渲染引擎。
 *
 * @example
 * ```typescript
 * const engine = new SkillTemplateEngine();
 * const result = engine.render("Hello, {{ name }}!", { name: "World" });
 * // => "Hello, World!"
 * ```
 */
export class SkillTemplateEngine {
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
   */
  renderEachLine(
    templates: string[],
    context: TemplateContext,
  ): string[] {
    return templates.map((t) => this.render(t, context));
  }

  // ── 私有方法 ──────────────────────────────────────────────

  private safeRender(value: unknown): string {
    const str = value === null || value === undefined
      ? this.options.undefinedPlaceholder
      : String(value);

    if (this.options.escapeHtml) {
      return this.escapeHtml(str);
    }
    return str;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ── 变量插值 ──────────────────────────────────────────────

  private renderVariables(template: string, context: TemplateContext): string {
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

      const value = this.resolvePath(context, path);

      if (value === undefined || value === null) {
        if (fallback !== undefined) {
          const fallbackValue = this.resolvePath(context, fallback);
          return this.safeRender(fallbackValue ?? fallback);
        }
        return this.safeRender(this.options.undefinedPlaceholder);
      }

      if (typeof value === "function") {
        return this.safeRender(value.call(context));
      }

      return this.safeRender(value);
    });
  }

  // ── 条件渲染 ──────────────────────────────────────────────

  private renderConditionals(template: string, context: TemplateContext): string {
    const ifRegex = new RegExp(
      `${this.escapeRegex(this.openTag)}\\s*#if\\s+(.+?)\\s*${this.escapeRegex(this.closeTag)}([\\s\\S]*?)${this.escapeRegex(this.openTag)}\\s*/if\\s*${this.escapeRegex(this.closeTag)}`,
      "g",
    );

    return template.replace(ifRegex, (_match, condition: string, body: string) => {
      const conditionValue = this.evaluateCondition(condition.trim(), context);

      // 处理 {{else}} 分支
      const elseMatch = body.match(
        new RegExp(
          `${this.escapeRegex(this.openTag)}\\s*else\\s*${this.escapeRegex(this.closeTag)}([\\s\\S]*)`,
        ),
      );

      let trueBody: string;
      let falseBody: string;

      if (elseMatch) {
        trueBody = body.substring(0, body.indexOf(this.openTag + "else" + this.closeTag));
        falseBody = elseMatch[1];
      } else {
        trueBody = body;
        falseBody = "";
      }

      const selectedBody = conditionValue ? trueBody : falseBody;
      return this.render(selectedBody, context);
    });
  }

  private evaluateCondition(condition: string, context: TemplateContext): boolean {
    let expr = condition.trim();

    const isNegated = expr.startsWith("!");
    if (isNegated) {
      expr = expr.substring(1).trim();
    }

    if (expr === "true") return !isNegated;
    if (expr === "false") return isNegated;

    const value = this.resolvePath(context, expr);
    const isTruthy = value !== undefined && value !== null && value !== false && value !== 0 && value !== "";

    return isNegated ? !isTruthy : isTruthy;
  }

  // ── 循环渲染 ──────────────────────────────────────────────

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

  private resolvePath(context: TemplateContext, pathStr: string): unknown {
    const parts = pathStr.split(".");
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

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
