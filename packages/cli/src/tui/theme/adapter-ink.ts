/**
 * tui/theme/adapter-ink.ts — v5 Ink 消费端适配器
 *
 * 将 DesignTokens 转换为 Ink <Text> / <Box> 组件的 style props。
 * Ink 的 color prop 接受 hex 字符串（如 "#48C78E"），
 * 因此适配器主要做语义映射而非格式转换。
 *
 * @module tui/theme/adapter-ink
 * @since v6
 */

import type { DesignTokens, BorderStyle } from "./tokens.js";
import { defaultTokens } from "./tokens.js";

// ─── Ink style prop 类型 ────────────────────

export interface InkTextStyle {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  dimColor?: boolean;
}

export interface InkBoxStyle {
  borderColor?: string;
  borderStyle?: "single" | "double" | "round" | "bold" | "singleDouble" | "doubleSingle" | "classic";
}

// ─── Ink 主题适配器接口 ─────────────────────

export interface InkThemeAdapter {
  // 语义文本样式
  primary: InkTextStyle;
  primaryDim: InkTextStyle;
  accent: InkTextStyle;
  textPrimary: InkTextStyle;
  textSecondary: InkTextStyle;
  textMuted: InkTextStyle;
  success: InkTextStyle;
  warning: InkTextStyle;
  error: InkTextStyle;
  info: InkTextStyle;

  // 状态样式
  statusThinking: InkTextStyle;
  statusExecuting: InkTextStyle;
  statusWaiting: InkTextStyle;
  statusError: InkTextStyle;
  statusComplete: InkTextStyle;

  // 风险等级
  riskLow: InkTextStyle;
  riskMedium: InkTextStyle;
  riskHigh: InkTextStyle;

  // 边框
  borderDefault: InkBoxStyle;
  borderFocus: InkBoxStyle;
  borderSubtle: InkBoxStyle;
  borderForStyle(style: BorderStyle): InkBoxStyle;

  // 快捷方法
  agentLabel(agentColor: string): InkTextStyle;
  userLabel: InkTextStyle;
  systemLabel: InkTextStyle;
  separator: InkTextStyle;
  streamingCursor: InkTextStyle;

  // 颜色直接取用
  color(path: string): string;
}

/**
 * 将 BorderStyle 映射为 Ink 的 borderStyle prop
 */
function mapBorderStyle(style: BorderStyle): InkBoxStyle["borderStyle"] {
  switch (style) {
    case "single":
      return "single";
    case "rounded":
    case "xilian":
      return "round";
    case "double":
      return "double";
    case "bold":
      return "bold";
    case "block":
      return "classic";
    default:
      return "round";
  }
}

/**
 * 创建 Ink 主题适配器
 * @param tokens 设计令牌（默认使用昔涟主题）
 */
export function createInkAdapter(tokens: DesignTokens = defaultTokens): InkThemeAdapter {
  const { color } = tokens;

  return {
    // 语义文本样式
    primary: { color: color.primary },
    primaryDim: { color: color.primaryDim },
    accent: { color: color.accent },
    textPrimary: { color: color.text.primary },
    textSecondary: { color: color.text.secondary },
    textMuted: { color: color.text.muted },
    success: { color: color.semantic.success },
    warning: { color: color.semantic.warning },
    error: { color: color.semantic.error },
    info: { color: color.semantic.info },

    // 状态样式
    statusThinking: { color: color.status.thinking },
    statusExecuting: { color: color.status.executing },
    statusWaiting: { color: color.status.waiting, dimColor: true },
    statusError: { color: color.status.error },
    statusComplete: { color: color.status.complete },

    // 风险等级
    riskLow: { color: color.risk.low },
    riskMedium: { color: color.risk.medium },
    riskHigh: { color: color.risk.high },

    // 边框
    borderDefault: {
      borderColor: color.border.default,
      borderStyle: mapBorderStyle(tokens.border.defaultStyle),
    },
    borderFocus: {
      borderColor: color.border.focus,
      borderStyle: mapBorderStyle(tokens.border.focusStyle),
    },
    borderSubtle: {
      borderColor: color.border.subtle,
      borderStyle: "single",
    },
    borderForStyle: (style) => ({
      borderColor: style === "xilian" ? color.primary : color.border.default,
      borderStyle: mapBorderStyle(style),
    }),

    // 快捷方法
    agentLabel: (agentColor) => ({ color: agentColor, bold: true }),
    userLabel: { color: color.text.primary, bold: true },
    systemLabel: { color: color.text.secondary, dimColor: true },
    separator: { color: color.text.muted, dimColor: true },
    streamingCursor: { color: color.primary },

    // 颜色直接取用（通过点路径）
    color: (path: string): string => {
      const parts = path.split(".");
      let current: unknown = color;
      for (const part of parts) {
        if (current && typeof current === "object" && part in current) {
          current = (current as Record<string, unknown>)[part];
        } else {
          return color.primary; // fallback
        }
      }
      return typeof current === "string" ? current : color.primary;
    },
  };
}

/** 默认 Ink 适配器实例（昔涟主题） */
export const inkTheme = createInkAdapter();
