/**
 * tui/theme/adapter-ansi.ts — v4 ANSI 消费端适配器
 *
 * 将 DesignTokens 转换为 ANSI 转义序列。
 * 零依赖——仅使用 tokens.ts 的纯数据 + 标准 ANSI escape。
 *
 * @module tui/theme/adapter-ansi
 * @since v6
 */

import type { DesignTokens, BorderStyle } from "./tokens.js";
import { defaultTokens } from "./tokens.js";
import { hexToRgb } from "./palette.js";
import { BORDER_CHARS, type BorderChars } from "./border-chars.js";

const ESC = "\x1b";
const CSI = `${ESC}[`;

// ─── 颜色转换 ─────────────────────────────────

/**
 * 生成 24-bit 前景色 ANSI 序列
 */
export function fg24(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `${CSI}38;2;${r};${g};${b}m`;
}

/**
 * 生成 24-bit 背景色 ANSI 序列
 */
export function bg24(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `${CSI}48;2;${r};${g};${b}m`;
}

/** ANSI 重置序列 */
export const RESET = `${CSI}0m`;
/** 粗体 */
export const BOLD = `${CSI}1m`;
/** 暗色 */
export const DIM = `${CSI}2m`;
/** 斜体 */
export const ITALIC = `${CSI}3m`;
/** 下划线 */
export const UNDERLINE = `${CSI}4m`;
/** 删除线 */
export const STRIKETHROUGH = `${CSI}9m`;

// ─── 语义化着色函数 ─────────────────────────

export interface AnsiThemeAdapter {
  // 颜色
  fg(hex: string): string;
  bg(hex: string): string;
  reset(): string;

  // 语义色（从 token 读取）
  primary(text: string): string;
  primaryDim(text: string): string;
  accent(text: string): string;
  textPrimary(text: string): string;
  textSecondary(text: string): string;
  textMuted(text: string): string;
  success(text: string): string;
  warning(text: string): string;
  error(text: string): string;
  info(text: string): string;

  // 样式
  bold(text: string): string;
  dim(text: string): string;
  italic(text: string): string;
  underline(text: string): string;

  // 组合
  boldPrimary(text: string): string;
  dimSecondary(text: string): string;

  // 边框
  borderChars(style: BorderStyle): BorderChars;
  borderFg(style?: BorderStyle): string;
  borderFocusFg(): string;

  // 状态
  statusThinking(text: string): string;
  statusExecuting(text: string): string;
  statusWaiting(text: string): string;
  statusError(text: string): string;
  statusComplete(text: string): string;

  // 风险等级
  riskLow(text: string): string;
  riskMedium(text: string): string;
  riskHigh(text: string): string;
}

/**
 * 创建 ANSI 主题适配器
 * @param tokens 设计令牌（默认使用昔涟主题）
 */
export function createAnsiAdapter(tokens: DesignTokens = defaultTokens): AnsiThemeAdapter {
  const { color } = tokens;

  const wrap = (prefix: string, text: string): string =>
    `${prefix}${text}${RESET}`;

  return {
    fg: fg24,
    bg: bg24,
    reset: () => RESET,

    // 语义色
    primary: (text) => wrap(fg24(color.primary), text),
    primaryDim: (text) => wrap(fg24(color.primaryDim), text),
    accent: (text) => wrap(fg24(color.accent), text),
    textPrimary: (text) => wrap(fg24(color.text.primary), text),
    textSecondary: (text) => wrap(fg24(color.text.secondary), text),
    textMuted: (text) => wrap(fg24(color.text.muted), text),
    success: (text) => wrap(fg24(color.semantic.success), text),
    warning: (text) => wrap(fg24(color.semantic.warning), text),
    error: (text) => wrap(fg24(color.semantic.error), text),
    info: (text) => wrap(fg24(color.semantic.info), text),

    // 样式
    bold: (text) => `${BOLD}${text}${RESET}`,
    dim: (text) => `${DIM}${text}${RESET}`,
    italic: (text) => `${ITALIC}${text}${RESET}`,
    underline: (text) => `${UNDERLINE}${text}${RESET}`,

    // 组合
    boldPrimary: (text) => `${BOLD}${fg24(color.primary)}${text}${RESET}`,
    dimSecondary: (text) => `${DIM}${fg24(color.text.secondary)}${text}${RESET}`,

    // 边框
    borderChars: (style) => BORDER_CHARS[style],
    borderFg: (style = tokens.border.defaultStyle) =>
      fg24(style === "xilian" ? color.primary : color.border.default),
    borderFocusFg: () => fg24(color.border.focus),

    // 状态
    statusThinking: (text) => wrap(fg24(color.status.thinking), text),
    statusExecuting: (text) => wrap(fg24(color.status.executing), text),
    statusWaiting: (text) => wrap(fg24(color.status.waiting), text),
    statusError: (text) => wrap(fg24(color.status.error), text),
    statusComplete: (text) => wrap(fg24(color.status.complete), text),

    // 风险等级
    riskLow: (text) => wrap(fg24(color.risk.low), text),
    riskMedium: (text) => wrap(fg24(color.risk.medium), text),
    riskHigh: (text) => wrap(fg24(color.risk.high), text),
  };
}

/** 默认 ANSI 适配器实例（昔涟主题） */
export const ansiTheme = createAnsiAdapter();
