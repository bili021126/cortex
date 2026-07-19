/**
 * tui/theme/border-chars.ts — Unicode 边框字符集
 *
 * 支持多种边框风格：单线、圆角、双线、粗线、块元素、昔涟主题。
 * v4 (ANSI) 和 v5 (Ink) 共享此字符集。
 *
 * @module tui/theme/border-chars
 * @since v6
 */

import type { BorderStyle } from "./tokens.js";

// ─── 边框字符接口 ─────────────────────────────

export interface BorderChars {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
  /** 交叉点（用于分割线） */
  cross: string;
  /** T 型连接（上） */
  topTee: string;
  /** T 型连接（下） */
  bottomTee: string;
  /** T 型连接（左） */
  leftTee: string;
  /** T 型连接（右） */
  rightTee: string;
  /** 标题装饰（可选） */
  titleDecor?: string;
}

// ─── 边框字符集注册表 ─────────────────────────

export const BORDER_CHARS: Record<BorderStyle, BorderChars> = {
  single: {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    horizontal: "─",
    vertical: "│",
    cross: "┼",
    topTee: "┬",
    bottomTee: "┴",
    leftTee: "├",
    rightTee: "┤",
  },
  rounded: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
    cross: "┼",
    topTee: "┬",
    bottomTee: "┴",
    leftTee: "├",
    rightTee: "┤",
  },
  double: {
    topLeft: "╔",
    topRight: "╗",
    bottomLeft: "╚",
    bottomRight: "╝",
    horizontal: "═",
    vertical: "║",
    cross: "╬",
    topTee: "╦",
    bottomTee: "╩",
    leftTee: "╠",
    rightTee: "╣",
  },
  bold: {
    topLeft: "┏",
    topRight: "┓",
    bottomLeft: "┗",
    bottomRight: "┛",
    horizontal: "━",
    vertical: "┃",
    cross: "╋",
    topTee: "┳",
    bottomTee: "┻",
    leftTee: "┣",
    rightTee: "┫",
  },
  block: {
    topLeft: "█",
    topRight: "█",
    bottomLeft: "█",
    bottomRight: "█",
    horizontal: "▀",
    vertical: "█",
    cross: "█",
    topTee: "▀",
    bottomTee: "▄",
    leftTee: "█",
    rightTee: "█",
  },
  xilian: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "━",
    vertical: "┃",
    cross: "┿",
    topTee: "┯",
    bottomTee: "┷",
    leftTee: "┠",
    rightTee: "┨",
    titleDecor: "🍀 ",
  },
};

// ─── 分隔线字符 ─────────────────────────────

export const SEPARATOR_CHARS = {
  /** 细线分隔 */
  thin: "─",
  /** 粗线分隔 */
  thick: "━",
  /** 点线分隔 */
  dotted: "┈",
  /** 双线分隔 */
  double: "═",
  /** 昔涟主题分隔（带装饰） */
  xilian: "━",
} as const;

// ─── 工具函数 ─────────────────────────────────

/**
 * 生成指定宽度的水平线
 */
export function horizontalLine(style: BorderStyle, width: number): string {
  const chars = BORDER_CHARS[style];
  return chars.horizontal.repeat(Math.max(0, width));
}

/**
 * 生成带标题的顶部边框
 */
export function titledTopBorder(
  style: BorderStyle,
  width: number,
  title?: string,
  titleDecor?: string,
): string {
  const chars = BORDER_CHARS[style];
  if (!title) {
    return chars.topLeft + chars.horizontal.repeat(Math.max(0, width - 2)) + chars.topRight;
  }
  const decor = titleDecor ?? chars.titleDecor ?? "";
  const fullTitle = decor + title;
  const padding = Math.max(0, width - fullTitle.length - 4);
  const leftPad = 1;
  const rightPad = padding - leftPad;
  return (
    chars.topLeft +
    chars.horizontal.repeat(leftPad) +
    " " + fullTitle + " " +
    chars.horizontal.repeat(Math.max(0, rightPad)) +
    chars.topRight
  );
}

/**
 * 生成完整的空边框（指定宽高）
 */
export function emptyBox(style: BorderStyle, width: number, height: number): string[] {
  const chars = BORDER_CHARS[style];
  const innerWidth = Math.max(0, width - 2);
  const lines: string[] = [];

  // 顶部
  lines.push(chars.topLeft + chars.horizontal.repeat(innerWidth) + chars.topRight);
  // 中间
  for (let i = 0; i < height - 2; i++) {
    lines.push(chars.vertical + " ".repeat(innerWidth) + chars.vertical);
  }
  // 底部
  lines.push(chars.bottomLeft + chars.horizontal.repeat(innerWidth) + chars.bottomRight);

  return lines;
}
