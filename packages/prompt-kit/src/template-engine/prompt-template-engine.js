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
import { PromptErrorCode } from "../types.js";
import { PromptError } from "../errors.js";
// 默认选项
const DEFAULT_OPTIONS = {
    delimiters: ["{{", "}}"],
    undefinedPlaceholder: "",
    escapeHtml: false,
    maxNestingDepth: 5,
};
/** 自闭合指令列表 — 这些指令不需要闭合标签 */
const SELF_CLOSING_DIRECTIVES = new Set(["date", "ref", "include", "block"]);
/**
 * PromptTemplateEngine —— 增强型 Prompt 模板渲染引擎。
 *
 * 继承 SimpleTemplateEngine 的核心语法，新增 prompt 专用指令。
 * 不依赖任何外部模板引擎库。
 */
export class PromptTemplateEngine {
    options;
    openTag;
    closeTag;
    helpers = new Map();
    directives = new Map();
    constructor(options = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        [this.openTag, this.closeTag] = this.options.delimiters;
        this.registerBuiltinDirectives();
        this.registerBuiltinHelpers();
    }
    /**
     * 渲染单块内容。
     */
    renderBlock(block, context) {
        return this.render(block.content, context, 0);
    }
    /**
     * 批量渲染（依次渲染，拼接分隔符）。
     */
    renderBlocks(blocks, context, separator = "\n\n") {
        return blocks
            .map((block) => this.renderBlock(block, context))
            .filter(Boolean)
            .join(separator);
    }
    /**
     * 渲染模板字符串。
     */
    render(template, context, depth = 0) {
        if (!template)
            return "";
        if (depth > this.options.maxNestingDepth) {
            throw new PromptError(`模板嵌套超过最大深度 ${this.options.maxNestingDepth}`, PromptErrorCode.CIRCULAR_REFERENCE, { depth, maxDepth: this.options.maxNestingDepth });
        }
        let result = template;
        // 1. 处理自闭合指令 {{#directive params}}
        result = this.renderSelfClosingDirectives(result, context, depth);
        // 2. 处理块指令 {{#directive params}}...{{/directive}}
        result = this.renderBlockDirectives(result, context, depth);
        // 3. 处理变量插值 {{ variable }} 和 {{ variable || fallback }}
        result = this.renderVariables(result, context);
        return result;
    }
    /**
     * 注册自定义辅助函数。
     */
    registerHelper(name, fn) {
        this.helpers.set(name, fn);
    }
    /**
     * 注册自定义指令。
     */
    registerDirective(name, handler) {
        this.directives.set(name, handler);
    }
    // ── 内置指令注册 ──────────────────────────────────────────
    registerBuiltinDirectives() {
        // #role — 角色切换
        this.directives.set("role", (params, body, context, engine, depth) => {
            const roleName = params.trim();
            const rolePersona = context.variables?.[`role_${roleName}`];
            if (rolePersona) {
                return `[${roleName} 角色]\n${rolePersona}\n${engine.render(body, context, depth + 1)}`;
            }
            return engine.render(body, context, depth + 1);
        });
        // #block — 块级引用（自闭合，通过 params 指定块 ID）
        this.directives.set("block", (params, _body, context, _engine, _depth) => {
            const blockMap = context.variables?.__blocks;
            const blockId = params.trim();
            if (blockMap?.[blockId]) {
                return blockMap[blockId];
            }
            return `[块 "${blockId}" 未找到]`;
        });
        // #ref — 跨模板引用（自闭合）
        this.directives.set("ref", (params, _body, _context, _engine, _depth) => {
            const templateId = params.trim();
            return `__REF_${templateId}__`;
        });
        // #include — 文件包含（自闭合）
        this.directives.set("include", (params, _body, _context, _engine, _depth) => {
            const filePath = params.trim();
            return `__INCLUDE_${filePath}__`;
        });
        // #date — 日期格式化（自闭合）
        this.directives.set("date", (params, _body, _context, _engine, _depth) => {
            const format = params.trim() || "YYYY-MM-DD";
            const now = new Date();
            return this.formatDate(now, format);
        });
        // #if — 条件渲染
        this.directives.set("if", (params, body, context, engine, depth) => {
            const conditionValue = this.evaluateCondition(params.trim(), context);
            // 处理 {{else}} 分支
            const elseTag = `${this.openTag}else${this.closeTag}`;
            const elseIndex = body.indexOf(elseTag);
            let trueBody;
            let falseBody;
            if (elseIndex !== -1) {
                trueBody = body.substring(0, elseIndex);
                falseBody = body.substring(elseIndex + elseTag.length);
            }
            else {
                trueBody = body;
                falseBody = undefined;
            }
            if (conditionValue) {
                return engine.render(trueBody, context, depth + 1);
            }
            else if (falseBody !== undefined) {
                return engine.render(falseBody, context, depth + 1);
            }
            return "";
        });
        // #each — 循环渲染
        this.directives.set("each", (params, body, context, engine, depth) => {
            const list = context.variables?.[params.trim()];
            if (!Array.isArray(list))
                return "";
            return list.map((item, index) => {
                const itemContext = {
                    ...context,
                    variables: {
                        ...context.variables,
                        this: item,
                        index,
                    },
                };
                return engine.render(body, itemContext, depth + 1);
            }).join("\n");
        });
        // /if, /each, /role — 闭合标签，无操作（渲染时被剥离）
        this.directives.set("/if", () => "");
        this.directives.set("/each", () => "");
        this.directives.set("/role", () => "");
    }
    registerBuiltinHelpers() {
        this.helpers.set("toUpper", (str) => String(str).toUpperCase());
        this.helpers.set("toLower", (str) => String(str).toLowerCase());
        this.helpers.set("trim", (str) => String(str).trim());
        this.helpers.set("json", (obj) => JSON.stringify(obj, null, 2));
    }
    // ── 自闭合指令渲染 ────────────────────────────────────────
    /**
     * 处理自闭合指令：{{#directive params}}
     * 这些指令没有 body 也没有闭合标签。
     */
    renderSelfClosingDirectives(template, context, depth) {
        const regex = new RegExp(`${this.escapeRegex(this.openTag)}\\s*#(\\w+)(?:\\s+(.+?))?\\s*${this.escapeRegex(this.closeTag)}`, "g");
        let result = template;
        let match;
        while ((match = regex.exec(result)) !== null) {
            const [fullMatch, directiveName, params] = match;
            // 只处理自闭合指令
            if (!SELF_CLOSING_DIRECTIVES.has(directiveName)) {
                continue;
            }
            const handler = this.directives.get(directiveName);
            if (!handler)
                continue;
            const replacement = handler(params?.trim() ?? "", "", context, this, depth);
            result = result.replace(fullMatch, replacement);
            regex.lastIndex = 0;
        }
        return result;
    }
    // ── 块指令渲染 ────────────────────────────────────────────
    /**
     * 处理块指令：{{#directive params}}...{{/directive}}
     * 这些指令有 body 和闭合标签。
     */
    renderBlockDirectives(template, context, depth) {
        const regex = new RegExp(`${this.escapeRegex(this.openTag)}\\s*#(\\w+)(?:\\s+(.+?))?\\s*${this.escapeRegex(this.closeTag)}([\\s\\S]*?)${this.escapeRegex(this.openTag)}\\s*\\/(\\w+)\\s*${this.escapeRegex(this.closeTag)}`, "g");
        let result = template;
        let match;
        while ((match = regex.exec(result)) !== null) {
            const [fullMatch, directiveName, params, body, closingTag] = match;
            if (directiveName !== closingTag) {
                continue;
            }
            // 自闭合指令由 renderSelfClosingDirectives 处理，这里跳过
            if (SELF_CLOSING_DIRECTIVES.has(directiveName)) {
                continue;
            }
            const handler = this.directives.get(directiveName);
            if (!handler)
                continue;
            const replacement = handler(params?.trim() ?? "", body, context, this, depth);
            result = result.replace(fullMatch, replacement);
            regex.lastIndex = 0;
        }
        return result;
    }
    // ── 变量插值 ──────────────────────────────────────────────
    /**
     * 处理模板中的变量插值。
     */
    renderVariables(template, context) {
        const variableRegex = new RegExp(`${this.escapeRegex(this.openTag)}\\s*(?!#|/|__)([\\s\\S]+?)\\s*${this.escapeRegex(this.closeTag)}`, "g");
        // 模板变量长度保护：超过 5000 字符视为异常输入
        if (template.length > 50000) {
            return template.slice(0, 50000);
        }
        return template.replace(variableRegex, (_match, expression) => {
            const trimmed = expression.trim();
            // 处理默认值语法：variable || fallback
            const pipeIndex = trimmed.indexOf("||");
            let path;
            let fallback;
            if (pipeIndex !== -1) {
                path = trimmed.substring(0, pipeIndex).trim();
                fallback = trimmed.substring(pipeIndex + 2).trim();
            }
            else {
                path = trimmed;
            }
            const value = this.resolvePath(context.variables, path);
            if (value === undefined || value === null) {
                if (fallback !== undefined) {
                    const fallbackValue = this.resolvePath(context.variables, fallback);
                    return this.safeRender(fallbackValue ?? fallback);
                }
                return this.safeRender(this.options.undefinedPlaceholder);
            }
            if (typeof value === "function") {
                // 安全修复：不将 context 作为 this 传入——防止函数通过 this 访问原型链
                return this.safeRender(value());
            }
            return this.safeRender(value);
        });
    }
    // ── 辅助方法 ──────────────────────────────────────────────
    safeRender(value) {
        const str = value === null || value === undefined
            ? this.options.undefinedPlaceholder
            : String(value);
        // 防御性转义模板分隔符，防止变量值破坏模板结构
        const openTag = this.options.delimiters[0];
        const closeTag = this.options.delimiters[1];
        let safe = str
            .replace(new RegExp(openTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "&#123;&#123;")
            .replace(new RegExp(closeTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "&#125;&#125;");
        if (this.options.escapeHtml) {
            safe = safe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }
        return safe;
    }
    resolvePath(obj, path) {
        const parts = path.split(".");
        let current = obj;
        for (const part of parts) {
            if (current === null || current === undefined) {
                return undefined;
            }
            // 防御 __proto__ / constructor / prototype 等原型链属性
            if (part === "__proto__" || part === "constructor" || part === "prototype") {
                return undefined;
            }
            if (typeof current === "object" && Object.prototype.hasOwnProperty.call(current, part)) {
                current = current[part];
            }
            else {
                return undefined;
            }
        }
        return current;
    }
    evaluateCondition(condition, context) {
        let expr = condition.trim();
        const isNegated = expr.startsWith("!");
        if (isNegated)
            expr = expr.substring(1).trim();
        if (expr === "true")
            return !isNegated;
        if (expr === "false")
            return isNegated;
        const value = context.variables?.[expr];
        const isTruthy = value !== undefined && value !== null && value !== false && value !== 0 && value !== "";
        return isNegated ? !isTruthy : isTruthy;
    }
    formatDate(date, format) {
        const map = {
            "YYYY": String(date.getFullYear()),
            "MM": String(date.getMonth() + 1).padStart(2, "0"),
            "DD": String(date.getDate()).padStart(2, "0"),
            "HH": String(date.getHours()).padStart(2, "0"),
            "mm": String(date.getMinutes()).padStart(2, "0"),
            "ss": String(date.getSeconds()).padStart(2, "0"),
        };
        let result = format;
        for (const [key, value] of Object.entries(map)) {
            result = result.replace(key, value);
        }
        return result;
    }
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
}
//# sourceMappingURL=prompt-template-engine.js.map