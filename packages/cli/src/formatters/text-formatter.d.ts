/**
 * text-formatter.ts — 纯文本输出格式器
 *
 * 设计原则：无 ANSI 转义码、无 Unicode 装饰符号、固定宽度对齐。
 * 适合管道 (|) 和重定向 (>)。
 *
 * @see CLI 设计文档 §6.2
 */
import type { Formatter } from "./index.js";
import type { CommandResult } from "../types.js";
export declare class TextFormatter implements Formatter {
    formatSuccess(result: CommandResult): string;
    formatError(result: CommandResult): string;
    formatInfo(message: string): string;
    formatTable(headers: string[], rows: string[][]): string;
    formatHeading(text: string): string;
}
//# sourceMappingURL=text-formatter.d.ts.map