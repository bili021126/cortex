/**
 * formatters/index.ts — 输出格式器注册表
 *
 * 提供三种输出格式的统一接口：纯文本（text）、JSON（json）、彩色（color）。
 * 按 CLI 设计文档 §6 输出格式实现。
 */
import type { OutputFormat, CommandResult } from "../types.js";
export interface Formatter {
    /** 格式化成功输出 */
    formatSuccess(result: CommandResult): string;
    /** 格式化错误输出 */
    formatError(result: CommandResult): string;
    /** 格式化信息输出（notify/status） */
    formatInfo(message: string): string;
    /** 格式化表格输出 */
    formatTable(headers: string[], rows: string[][]): string;
    /** 格式化标题 */
    formatHeading(text: string): string;
}
export declare function getFormatter(format: OutputFormat): Formatter;
export declare function detectDefaultFormat(): OutputFormat;
//# sourceMappingURL=index.d.ts.map