/**
 * color-formatter.ts — 彩色输出格式器
 *
 * 设计原则：ANSI 颜色 + Unicode 符号 + 实时流式更新。
 * 仅在终端交互时启用（自动检测 isTTY）。
 *
 * @see CLI 设计文档 §6.4
 */
import type { Formatter } from "./index.js";
import type { CommandResult } from "../types.js";
export declare class ColorFormatter implements Formatter {
    formatSuccess(result: CommandResult): string;
    formatError(result: CommandResult): string;
    formatInfo(message: string): string;
    formatTable(headers: string[], rows: string[][]): string;
    formatHeading(text: string): string;
    /** 内部：给文本添加颜色 */
    private _colorize;
}
//# sourceMappingURL=color-formatter.d.ts.map