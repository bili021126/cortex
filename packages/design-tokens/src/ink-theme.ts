/**
 * @cortex/design-tokens — Ink (CLI TUI) 专用主题
 *
 * React Ink 组件使用 chalk 色彩，不支持 CSS variables。
 * 此模块导出 Ink 组件可直接引用的颜色常量。
 */

import { ENGINEERING, font } from "./tokens.js";

/**
 * CLI 主题——始终使用 ENGINEERING palette（冷色工程界面）。
 * Ink 组件通过 `<Text color={inkTheme.text.primary}>` 使用。
 */
export const inkTheme = {
  color: {
    primary: ENGINEERING.primary,
    accent: ENGINEERING.accent,
    success: ENGINEERING.semantic.success,
    error: ENGINEERING.semantic.error,
    warning: ENGINEERING.semantic.warning,
    info: ENGINEERING.semantic.info,
    textPrimary: ENGINEERING.text.primary,
    textSecondary: ENGINEERING.text.secondary,
    textMuted: ENGINEERING.text.muted,
    diffAdded: ENGINEERING.diff.addedLine,
    diffRemoved: ENGINEERING.diff.removedLine,
    border: ENGINEERING.border.default,
  },
  /** 状态栏固定高度（行数） */
  statusBarHeight: 1,
  /** diff 块最大行数，超过则折叠 */
  diffMaxVisibleLines: 20,
  /** 工具调用输出最大行数 */
  toolOutputMaxLines: 8,
  /** 字体提示（终端无法控制字体，仅用于文档） */
  fontFamily: font.code,
  /** 间距（字符数近似） */
  indent: 2,
  sectionGap: 1, // 空行数
} as const;

export type InkTheme = typeof inkTheme;
