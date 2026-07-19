/**
 * tui/layout/index.ts — 布局系统统一导出
 *
 * @module tui/layout
 * @since v6
 */

// ─── 原语 ─────────────────────────────────
export type {
  PanelConfig,
  SplitConfig,
  SplitDirection,
  SplitSize,
  SeparatorStyle,
  LayoutMode,
} from "./primitives.js";
export { detectLayoutMode, calculateSplitSizes } from "./primitives.js";

// ─── 面板预设 ─────────────────────────────
export { PANEL_PRESETS, getPanelConfig } from "./panel-presets.js";

// ─── v4 ANSI 布局 ─────────────────────────
export { renderAnsiPanel, renderSeparator, renderStatusBar } from "./adapter-ansi.js";

// ─── v5 Ink 布局 ──────────────────────────
export { Panel, SplitPane, Separator } from "./adapter-ink.js";
export type { PanelProps, SplitPaneProps, SeparatorProps } from "./adapter-ink.js";
