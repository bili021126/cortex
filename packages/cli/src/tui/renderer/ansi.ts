/**
 * tui/renderer/ansi.ts — ANSI 渲染原语
 *
 * 零依赖的终端控制能力层。所有 ANSI escape 序列集中在此文件，
 * 其余模块通过语义化 API 调用，不直接拼接 escape 字符串。
 *
 * 设计原则：
 * - 所有 escape 写在一个文件里，调色盘统一管理
 * - 语义化 API：调用 cursorUp(2) 而非手写 \x1b[2A
 * - Box 增量更新：只重绘变化行，不刷新整个面板
 * - StatusLine：终端底部固定行，内容更新不滚动
 *
 * @module tui/renderer/ansi
 * @since v3 — CLI TUI 全栈重构
 */

// ═══════════════════════════════════════════════════════════
// §1 ANSI 基础常量和工具
// ═══════════════════════════════════════════════════════════

const ESC = "\x1b";
const CSI = `${ESC}[`;

/** ANSI 样式码 */
export const StyleCode = {
  reset: 0,
  bold: 1,
  dim: 2,
  italic: 3,
  underline: 4,
  strikethrough: 9,
} as const;

/** 标准 16 色 ANSI 色码 */
export const ColorCode = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  brightBlack: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
  brightBlue: 94,
  brightMagenta: 95,
  brightCyan: 96,
  brightWhite: 97,
} as const;

export type ColorName = keyof typeof ColorCode;
export type StyleName = keyof typeof StyleCode;

// ═══════════════════════════════════════════════════════════
// §2 光标控制
// ═══════════════════════════════════════════════════════════

/** 光标上移 n 行 */
export function cursorUp(n: number = 1): string {
  return `${CSI}${n}A`;
}

/** 光标下移 n 行 */
export function cursorDown(n: number = 1): string {
  return `${CSI}${n}B`;
}

/** 光标右移 n 列 */
export function cursorRight(n: number = 1): string {
  return `${CSI}${n}C`;
}

/** 光标移动到指定列 */
export function cursorToColumn(col: number): string {
  return `${CSI}${col}G`;
}

/** 隐藏光标 */
export const cursorHide = `${CSI}?25l`;

/** 显示光标 */
export const cursorShow = `${CSI}?25h`;

/** 保存光标位置 */
export const cursorSave = `${ESC}7`;

/** 恢复光标位置 */
export const cursorRestore = `${ESC}8`;

// ═══════════════════════════════════════════════════════════
// §3 擦除
// ═══════════════════════════════════════════════════════════

/** 擦除当前行 */
export const eraseLine = `${CSI}2K`;

/** 擦除从光标到行首 */
export const eraseLineStart = `${CSI}1K`;

/** 擦除从光标到行尾 */
export const eraseLineEnd = `${CSI}0K`;

/** 擦除整个屏幕 */
export const eraseScreen = `${CSI}2J`;

/** 擦除从光标到屏幕尾 */
export const eraseScreenDown = `${CSI}0J`;

/** 向上滚动 n 行 */
export function scrollUp(n: number = 1): string {
  return `${CSI}${n}S`;
}

/** 向下滚动 n 行 */
export function scrollDown(n: number = 1): string {
  return `${CSI}${n}T`;
}

// ═══════════════════════════════════════════════════════════
// §4 样式
// ═══════════════════════════════════════════════════════════

/**
 * 为文本包裹 ANSI 样式。
 *
 * @param text 原始文本
 * @param codes ANSI 样式码（可多个组合）
 * @returns 包裹后的文本
 */
export function style(text: string, ...codes: number[]): string {
  if (codes.length === 0) return text;
  const prefix = `${CSI}${codes.join(";")}m`;
  return `${prefix}${text}${CSI}0m`;
}

/** ANSI 256 色前景色 */
export function fg256(code: number): string {
  return `${CSI}38;5;${code}m`;
}

/** ANSI 256 色背景色 */
export function bg256(code: number): string {
  return `${CSI}48;5;${code}m`;
}

/** 重置全部样式 */
export const styleReset = `${CSI}0m`;

// ── 语义化样式快捷方式 ──

export function bold(text: string): string {
  return style(text, StyleCode.bold);
}

export function dim(text: string): string {
  return style(text, StyleCode.dim);
}

export function italic(text: string): string {
  return style(text, StyleCode.italic);
}

export function underline(text: string): string {
  return style(text, StyleCode.underline);
}

/** 指定标准色 */
export function color(text: string, c: ColorName): string {
  return style(text, ColorCode[c]);
}

/** ANSI 256 色 */
export function color256(text: string, code: number): string {
  return `${fg256(code)}${text}${styleReset}`;
}


// ═══════════════════════════════════════════════════════════
// §7 终端尺寸
// ═══════════════════════════════════════════════════════════

/** 获取终端宽度（列数），默认 80 */
export function terminalWidth(): number {
  return process.stdout.columns ?? 80;
}

/** 获取终端高度（行数），默认 24 */
export function terminalHeight(): number {
  return process.stdout.rows ?? 24;
}

