/**
 * tui/layout/panel-presets.ts — 预定义面板类型
 *
 * @module tui/layout/panel-presets
 * @since v6
 */

import type { PanelConfig } from "./primitives.js";

/**
 * 预定义面板配置
 */
export const PANEL_PRESETS = {
  /** 聊天面板 */
  chat: {
    border: "rounded" as const,
    padding: "sm" as const,
    title: "",
    showBorder: true,
  },
  /** 工具调用面板 */
  tool: {
    border: "single" as const,
    padding: "xs" as const,
    title: "",
    showBorder: true,
  },
  /** 权限确认面板 */
  permission: {
    border: "double" as const,
    padding: "md" as const,
    title: "⚠ 权限确认",
    showBorder: true,
  },
  /** 状态栏 */
  status: {
    border: "single" as const,
    padding: "xs" as const,
    showBorder: false,
  },
  /** 侧边栏 */
  sidebar: {
    border: "rounded" as const,
    padding: "sm" as const,
    showBorder: true,
  },
  /** 输入区域 */
  input: {
    border: "rounded" as const,
    padding: "xs" as const,
    showBorder: true,
  },
  /** 任务树面板 */
  taskTree: {
    border: "rounded" as const,
    padding: "sm" as const,
    title: "📋 任务",
    showBorder: true,
  },
  /** 帮助面板 */
  help: {
    border: "double" as const,
    padding: "md" as const,
    title: "? 帮助",
    showBorder: true,
  },
  /** 昔涟主题面板 */
  xilian: {
    border: "xilian" as const,
    padding: "sm" as const,
    titleDecor: "🍀 ",
    showBorder: true,
  },
} as const satisfies Record<string, Partial<PanelConfig>>;

/**
 * 获取面板配置（合并预设和自定义覆盖）
 */
export function getPanelConfig(
  preset: keyof typeof PANEL_PRESETS | null,
  overrides?: Partial<PanelConfig>,
): PanelConfig {
  const base = preset ? PANEL_PRESETS[preset] : {};
  return {
    border: "rounded",
    padding: "sm",
    showBorder: true,
    ...base,
    ...overrides,
  } as PanelConfig;
}
