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
import { cliTheme } from "../theme/cli-theme.js";
import { defaultTokens } from "../tui/theme/tokens.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

/**
 * 原神+崩铁主题彩色输出——与 TUI 共享 DesignTokens（星轨蓝/元素金/深空）
 */
export class ColorFormatter implements Formatter {
  formatSuccess(result: CommandResult): string {
    if (result.output) return result.output;
    if (result.data) return cliTheme.fg(defaultTokens.color.semantic.info, JSON.stringify(result.data, null, 2));
    return cliTheme.success("成功");
  }

  formatError(result: CommandResult): string {
    const msg = result.error ?? "未知错误";
    return cliTheme.error(msg);
  }

  formatInfo(message: string): string {
    return cliTheme.info(message);
  }

  formatTable(headers: string[], rows: string[][]): string {
    if (rows.length === 0) return cliTheme.muted("(空)");

    const colWidths = headers.map((h, i) => {
      const maxData = Math.max(...rows.map((r) => (r[i] ?? "").length));
      return Math.max(h.length, maxData);
    });

    // 星轨蓝表头
    const headerLine = headers
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      .map((h, i) => `${BOLD}${cliTheme.fg(defaultTokens.color.text.primary, h.padEnd(colWidths[i]!))}${RESET}`)
      .join("  ");

    const separator = colWidths
      .map((w) => cliTheme.muted("─".repeat(w)))
      .join("  ");

    const dataLines = rows.map((r) =>
      r.map((cell, i) => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const val = (cell ?? "").padEnd(colWidths[i]!);
        // 根据语义染色
        if (i === 0) return cliTheme.fg(defaultTokens.color.semantic.info, val);
        if (cell === "awake" || cell === "done" || cell === "ok")
          return cliTheme.fg(defaultTokens.color.semantic.success, val);
        if (cell === "failed" || cell === "error" || cell === "draining")
          return cliTheme.fg(defaultTokens.color.semantic.error, val);
        return val;
      }).join("  "),
    );

    return [headerLine, separator, ...dataLines].join("\n");
  }

  formatHeading(text: string): string {
    return cliTheme.heading(`── ${text} ──`);
  }
}
