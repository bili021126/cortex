/**
 * tui/layout/primitives.ts — 布局原语定义
 *
 * 定义面板、分割、间距等布局抽象，供 v4/v5 共同消费。
 *
 * @module tui/layout/primitives
 * @since v6
 */

import type { BorderStyle } from "../theme/tokens.js";

// ─── 面板配置 ─────────────────────────────

export interface PanelConfig {
  /** 面板标题 */
  title?: string;
  /** 标题对齐 */
  titleAlign?: "left" | "center" | "right";
  /** 边框风格 */
  border: BorderStyle;
  /** 内边距（引用 spacing token key） */
  padding: "xxs" | "xs" | "sm" | "md" | "lg" | "xl";
  /** 外边距 */
  margin?: "xxs" | "xs" | "sm" | "md" | "lg" | "xl";
  /** 最小宽度 */
  minWidth?: number;
  /** 最大宽度 */
  maxWidth?: number;
  /** 是否可折叠 */
  collapsible?: boolean;
  /** 是否折叠 */
  collapsed?: boolean;
  /** 是否显示边框 */
  showBorder?: boolean;
  /** 标题装饰（如 emoji） */
  titleDecor?: string;
}

// ─── 分割配置 ─────────────────────────────

export type SplitDirection = "horizontal" | "vertical";

export type SplitSize = number | "auto" | "min" | "max";

export interface SplitConfig {
  /** 分割方向 */
  direction: SplitDirection;
  /** 各分区大小 */
  sizes: SplitSize[];
  /** 是否可调整大小 */
  resizable?: boolean;
  /** 分隔线风格 */
  separator?: SeparatorStyle;
}

export type SeparatorStyle = "thin" | "thick" | "dotted" | "double" | "none";

// ─── 布局模式 ─────────────────────────────

export type LayoutMode = "full" | "compact" | "minimal";

/**
 * 根据终端宽度自动选择布局模式
 */
export function detectLayoutMode(columns: number): LayoutMode {
  if (columns >= 120) return "full";
  if (columns >= 80) return "compact";
  return "minimal";
}

/**
 * 计算分割区域的实际像素尺寸
 */
export function calculateSplitSizes(
  totalSize: number,
  sizes: SplitSize[],
  separatorWidth: number = 1,
): number[] {
  const totalSeparators = Math.max(0, sizes.length - 1) * separatorWidth;
  const available = totalSize - totalSeparators;

  // 计算固定尺寸和 flex 部分
  let fixedTotal = 0;
  let flexTotal = 0;

  for (const size of sizes) {
    if (typeof size === "number") {
      fixedTotal += size;
    } else if (size === "min") {
      fixedTotal += 10; // 最小默认值
    } else {
      flexTotal += 1;
    }
  }

  const flexUnit = Math.max(1, Math.floor((available - fixedTotal) / Math.max(1, flexTotal)));

  return sizes.map((size) => {
    if (typeof size === "number") return size;
    if (size === "min") return 10;
    if (size === "max") return available - fixedTotal;
    return flexUnit; // "auto"
  });
}
