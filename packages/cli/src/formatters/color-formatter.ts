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

// ANSI 颜色码
const Colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
} as const;

export class ColorFormatter implements Formatter {
  formatSuccess(result: CommandResult): string {
    if (result.output) return result.output;
    if (result.data) return this._colorize(JSON.stringify(result.data, null, 2), Colors.cyan);
    return `${Colors.green}✅ 成功${Colors.reset}`;
  }

  formatError(result: CommandResult): string {
    const msg = result.error ?? "未知错误";
    return `${Colors.red}❌ 错误: ${msg}${Colors.reset}`;
  }

  formatInfo(message: string): string {
    return `${Colors.blue}ℹ️ ${message}${Colors.reset}`;
  }

  formatTable(headers: string[], rows: string[][]): string {
    if (rows.length === 0) return `${Colors.dim}(空)${Colors.reset}`;

    const colWidths = headers.map((h, i) => {
      const maxData = Math.max(...rows.map((r) => (r[i] ?? "").length));
      return Math.max(h.length, maxData);
    });

    // 彩色表头
    const headerLine = headers
      .map((h, i) => `${Colors.bold}${Colors.white}${h.padEnd(colWidths[i])}${Colors.reset}`)
      .join("  ");

    const separator = colWidths
      .map((w) => `${Colors.dim}${"─".repeat(w)}${Colors.reset}`)
      .join("  ");

    const dataLines = rows.map((r) =>
      r.map((cell, i) => {
        const val = (cell ?? "").padEnd(colWidths[i]);
        // 根据语义染色
        if (i === 0) return `${Colors.cyan}${val}${Colors.reset}`;
        if (cell === "awake" || cell === "done" || cell === "ok")
          return `${Colors.green}${val}${Colors.reset}`;
        if (cell === "failed" || cell === "error" || cell === "draining")
          return `${Colors.red}${val}${Colors.reset}`;
        return val;
      }).join("  "),
    );

    return [headerLine, separator, ...dataLines].join("\n");
  }

  formatHeading(text: string): string {
    return `${Colors.bold}${Colors.white}── ${text} ──${Colors.reset}`;
  }

  /** 内部：给文本添加颜色 */
  private _colorize(text: string, color: string): string {
    return `${color}${text}${Colors.reset}`;
  }
}
