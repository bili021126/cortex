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
export declare class SkillTemplateEngine {
    private options;
    private openTag;
    private closeTag;
    constructor(options?: TemplateEngineOptions);
    /**
     * 渲染模板字符串。
     *
     * @param template 模板字符串
     * @param context  变量上下文
     * @returns 渲染后的字符串
     */
    render(template: string, context: TemplateContext): string;
    /**
     * 渲染字符串数组模板（每条依次渲染，拼接换行）。
     */
    renderEachLine(templates: string[], context: TemplateContext): string[];
    private safeRender;
    private escapeHtml;
    private renderVariables;
    private renderConditionals;
    private evaluateCondition;
    private renderEach;
    private resolvePath;
    private escapeRegex;
}
//# sourceMappingURL=skill-template-engine.d.ts.map