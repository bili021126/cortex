/**
 * json-formatter.ts — JSON 输出格式器
 *
 * 设计原则：严格 JSON 格式，包含 status / data / meta 三层结构。
 * 适合 jq 管道消费。
 *
 * @see CLI 设计文档 §6.3
 */
import type { Formatter } from "./index.js";
import type { CommandResult } from "../types.js";
export declare class JsonFormatter implements Formatter {
    private _buildMeta;
    formatSuccess(result: CommandResult): string;
    formatError(result: CommandResult): string;
    formatInfo(message: string): string;
    formatTable(headers: string[], rows: string[][]): string;
    formatHeading(text: string): string;
}
//# sourceMappingURL=json-formatter.d.ts.map