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

export class TextFormatter implements Formatter {
  formatSuccess(result: CommandResult): string {
    if (result.output) return result.output;
    if (result.data) return JSON.stringify(result.data, null, 2);
    return "✓ 成功";
  }

  formatError(result: CommandResult): string {
    const msg = result.error ?? "未知错误";
    return `✗ 错误: ${msg}`;
  }

  formatInfo(message: string): string {
    return message;
  }

  formatTable(headers: string[], rows: string[][]): string {
    if (rows.length === 0) return "(空)";

    // 计算每列最大宽度
    const colWidths = headers.map((h, i) => {
      const maxData = Math.max(...rows.map((r) => (r[i] ?? "").length));
      return Math.max(h.length, maxData);
    });

    // 表头
    const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join("  ");
    const separator = colWidths.map((w) => "─".repeat(w)).join("  ");

    // 数据行
    const dataLines = rows.map((r) =>
      r.map((cell, i) => (cell ?? "").padEnd(colWidths[i])).join("  "),
    );

    return [headerLine, separator, ...dataLines].join("\n");
  }

  formatHeading(text: string): string {
    return `── ${text} ──`;
  }
}
