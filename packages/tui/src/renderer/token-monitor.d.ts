/**
 * tui/renderer/token-monitor.ts — Token 用量实时面板
 *
 * Claude Code 标志性功能——实时显示 Token 消耗和上下文窗口压力。
 * 每次 LLM API 调用后更新，累加会话总 token。
 *
 * 渲染格式（终端底部固定行）：
 * ```
 * 📊 Token: 输入 12.4k | 输出 3.2k | 上下文 58% | 本次会话 45k
 * ```
 *
 * @module tui/renderer/token-monitor
 * @since v3 — CLI TUI 全栈重构
 */
import type { TuiEvent } from "../types.js";
import { StatusLine } from "./ansi.js";
export declare class TokenMonitor {
    private sessionPromptTokens;
    private sessionCompletionTokens;
    private contextWindowSize;
    private statusLine;
    private visible;
    constructor(statusLine?: StatusLine);
    /** 处理事件 */
    handleEvent(event: TuiEvent): void;
    /** 更新 Token 数据 */
    private update;
    /** 渲染底部状态行 */
    private renderStatusLine;
    /** 获取会话总 Token */
    get sessionTotalTokens(): number;
    /** 获取上下文占用比例 */
    get contextUsageRatio(): number;
    /** 设置上下文窗口大小 */
    setContextWindowSize(size: number): void;
    /** 设置可见性 */
    setVisible(v: boolean): void;
    /** 重置会话计数 */
    reset(): void;
    /** 清理资源 */
    dispose(): void;
}
//# sourceMappingURL=token-monitor.d.ts.map