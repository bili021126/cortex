/**
 * cli-theme.ts — CLI 输出主题（原神+崩铁——与 TUI 共享 DesignTokens）
 *
 * 语义输出：成功/警告/错误/信息/标题/边框——ANSI 24-bit 色。
 * 与 TUI 的 inkTheme 同源（defaultTokens）——CLI/TUI 风格统一。
 *
 * @module cli/theme/cli-theme
 * @since v6.2 — CLI 风格化统一（原神+崩铁视觉语言）
 */

import { defaultTokens } from "../tui/theme/tokens.js";
import { fg24 } from "../tui/theme/adapter-ansi.js";

const ESC = "\x1b";
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;

/** 原神+崩铁主题语义输出（CLI 侧——ANSI 24-bit） */
export const cliTheme = {
  /** 星轨蓝标题 */
  heading(text: string): string {
    return `${BOLD}${fg24(defaultTokens.color.primary)}${text}${RESET}`;
  },
  /** 元素金强调 */
  accent(text: string): string {
    return `${BOLD}${fg24(defaultTokens.color.accent)}${text}${RESET}`;
  },
  /** 成功（✦ 星轨星） */
  success(text: string): string {
    return `${fg24(defaultTokens.color.semantic.success)}✦ ${text}${RESET}`;
  },
  /** 警告 */
  warn(text: string): string {
    return `${fg24(defaultTokens.color.semantic.warning)}⚠ ${text}${RESET}`;
  },
  /** 错误 */
  error(text: string): string {
    return `${fg24(defaultTokens.color.semantic.error)}✖ ${text}${RESET}`;
  },
  /** 信息 */
  info(text: string): string {
    return `${fg24(defaultTokens.color.semantic.info)}ℹ ${text}${RESET}`;
  },
  /** 次要文本（暗淡） */
  muted(text: string): string {
    return `${DIM}${fg24(defaultTokens.color.text.secondary)}${text}${RESET}`;
  },
  /** 星轨分隔线 */
  rule(len = 60): string {
    return `${fg24(defaultTokens.color.border.subtle)}${"─".repeat(len)}${RESET}`;
  },
  /** 任意 token 色 */
  fg(hex: string, text: string): string {
    return `${fg24(hex)}${text}${RESET}`;
  },
};

/** 便捷：非 TTY 时自动降级为纯文本 */
export function ttySafe(fn: (s: string) => string, text: string): string {
  return process.stdout.isTTY ? fn(text) : text;
}
