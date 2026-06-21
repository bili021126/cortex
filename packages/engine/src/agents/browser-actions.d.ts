import type { Page } from "playwright";
/** browser_do 单个操作的参数（来自 LLM tool_call） */
export interface BrowserActionParams {
    [key: string]: unknown;
    action?: string;
    url?: string;
    selector?: string;
    text?: string;
    timeout?: number;
    /** evaluate: 在页面上下文中执行的 JS 表达式 */
    expression?: string;
    /** evaluate: 是否返回 innerText 而非 innerHTML（默认 false） */
    textOnly?: boolean;
    /** screenshot: 是否截取全页面（默认 false——仅视口） */
    fullPage?: boolean;
    /** wait: 等待条件 'selector' | 'ms' | 'network' */
    waitFor?: string;
    /** wait: 等待毫秒数（waitFor='ms' 时使用） */
    ms?: number;
    /** scroll: 滚动目标 'top' | 'bottom' | 'selector' */
    to?: string;
    /** scroll: 目标选择器（to='selector' 时使用） */
    scrollToSelector?: string;
}
/** browser_do 单个操作的执行结果 */
export interface BrowserActionResult {
    success: boolean;
    output?: string;
    error?: string;
}
/** 单个 browser_do 操作的声明式定义 */
export interface BrowserActionDef {
    /** 操作名（对应 action 参数值，如 "navigate"） */
    name: string;
    /** 必需的参数键列表 */
    requiredParams: string[];
    /** 执行函数 */
    handler: (page: Page, params: BrowserActionParams, timeout: number) => Promise<BrowserActionResult>;
}
export declare const BUILTIN_BROWSER_ACTIONS: BrowserActionDef[];
/**
 * 从 action 注册表构建 browser_do 工具处理器。
 * 返回一个可直接注册到 Toolkit 的 handler 函数。
 */
export declare function buildBrowserDoHandler(actions: BrowserActionDef[], pageRef: {
    current: Page | null;
}): (params: BrowserActionParams) => Promise<BrowserActionResult>;
//# sourceMappingURL=browser-actions.d.ts.map