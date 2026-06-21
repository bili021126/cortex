/**
 * @cortex/prompt-kit — Prompt 模板渲染引擎
 *
 * 提供专为 prompt 场景增强的模板渲染能力，继承 skill-kit 的
 * SimpleTemplateEngine 语法并扩展 prompt 专用指令。
 *
 * 支持的语法：
 * - {{ variable }} — 变量插值
 * - {{#if cond}}...{{/if}} — 条件渲染
 * - {{#each list}}...{{/each}} — 循环渲染
 * - {{#role name}}...{{/role}} — 角色切换块
 * - {{#block id}}...{{/block}} — 块级引用
 * - {{#ref templateId}} — 跨模板引用（自闭合）
 * - {{#include filepath}} — 文件包含（自闭合）
 * - {{#date format}} — 日期格式化（自闭合）
 *
 * @see DESIGN.md §3.3 PromptTemplateEngine
 */
import { type PromptBlock, type PromptContext, type TemplateEngineOptions } from "../types.js";
/**
 * 指令处理器签名。
 */
export type DirectiveHandler = (params: string, body: string, context: PromptContext, engine: PromptTemplateEngine, depth: number) => string;
/**
 * PromptTemplateEngine —— 增强型 Prompt 模板渲染引擎。
 *
 * 继承 SimpleTemplateEngine 的核心语法，新增 prompt 专用指令。
 * 不依赖任何外部模板引擎库。
 */
export declare class PromptTemplateEngine {
    private options;
    private openTag;
    private closeTag;
    private helpers;
    private directives;
    constructor(options?: TemplateEngineOptions);
    /**
     * 渲染单块内容。
     */
    renderBlock(block: PromptBlock, context: PromptContext): string;
    /**
     * 批量渲染（依次渲染，拼接分隔符）。
     */
    renderBlocks(blocks: PromptBlock[], context: PromptContext, separator?: string): string;
    /**
     * 渲染模板字符串。
     */
    render(template: string, context: PromptContext, depth?: number): string;
    /**
     * 注册自定义辅助函数。
     */
    registerHelper(name: string, fn: (...args: unknown[]) => unknown): void;
    /**
     * 注册自定义指令。
     */
    registerDirective(name: string, handler: DirectiveHandler): void;
    private registerBuiltinDirectives;
    private registerBuiltinHelpers;
    /**
     * 处理自闭合指令：{{#directive params}}
     * 这些指令没有 body 也没有闭合标签。
     */
    private renderSelfClosingDirectives;
    /**
     * 处理块指令：{{#directive params}}...{{/directive}}
     * 这些指令有 body 和闭合标签。
     */
    private renderBlockDirectives;
    /**
     * 处理模板中的变量插值。
     */
    private renderVariables;
    private safeRender;
    private resolvePath;
    private evaluateCondition;
    private formatDate;
    private escapeRegex;
}
//# sourceMappingURL=prompt-template-engine.d.ts.map