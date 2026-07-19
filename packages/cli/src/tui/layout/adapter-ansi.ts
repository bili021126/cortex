/**
 * tui/layout/adapter-ansi.ts — v4 布局渲染器
 *
 * 将面板配置转换为 ANSI 渲染输出。
 *
 * @module tui/layout/adapter-ansi
 * @since v6
 */

import type { PanelConfig, SeparatorStyle } from "./primitives.js";
import { BORDER_CHARS, SEPARATOR_CHARS, titledTopBorder } from "../theme/border-chars.js";
import { defaultTokens } from "../theme/tokens.js";
import { fg24, RESET, BOLD } from "../theme/adapter-ansi.js";

/**
 * 渲染 ANSI 面板
 */
export function renderAnsiPanel(
  content: string[],
  config: PanelConfig,
  width: number,
): string[] {
  const chars = BORDER_CHARS[config.border];
  const padding = defaultTokens.spacing[config.padding];
  const innerWidth = width - 2; // 减去左右边框

  const lines: string[] = [];

  if (config.showBorder !== false) {
    // 顶部边框
    lines.push(titledTopBorder(config.border, width, config.title, config.titleDecor));

    // 内容行
    for (const line of content) {
      const paddedLine = " ".repeat(padding) + line + " ".repeat(Math.max(0, innerWidth - line.length - padding));
      lines.push(`${chars.vertical}${paddedLine.slice(0, innerWidth)}${chars.vertical}`);
    }

    // 底部边框
    lines.push(chars.bottomLeft + chars.horizontal.repeat(innerWidth) + chars.bottomRight);
  } else {
    // 无边框，仅 padding
    for (const line of content) {
      lines.push(" ".repeat(padding) + line);
    }
  }

  return lines;
}

/**
 * 渲染分隔线
 */
export function renderSeparator(
  style: SeparatorStyle,
  width: number,
  color?: string,
): string {
  if (style === "none") return "";
  const char = SEPARATOR_CHARS[style];
  const line = char.repeat(width);
  if (color) {
    return `${fg24(color)}${line}${RESET}`;
  }
  return line;
}

/**
 * 渲染状态栏
 */
export function renderStatusBar(
  segments: Array<{ text: string; color?: string; bold?: boolean }>,
  width: number,
): string {
  let result = "";
  let usedWidth = 0;

  for (const seg of segments) {
    let styled = seg.text;
    if (seg.bold) styled = `${BOLD}${styled}${RESET}`;
    if (seg.color) styled = `${fg24(seg.color)}${styled}${RESET}`;
    result += styled;
    usedWidth += seg.text.length;
  }

  // 填充剩余空间
  const remaining = Math.max(0, width - usedWidth);
  result += " ".repeat(remaining);

  return result;
}
