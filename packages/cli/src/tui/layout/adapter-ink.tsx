/**
 * tui/layout/adapter-ink.tsx — v5 Ink 布局组件
 *
 * 提供 Panel、SplitPane、Separator 等 Ink 组件。
 *
 * @module tui/layout/adapter-ink
 * @since v6
 */

import { Box, Text, useStdout } from "ink";
import type { ReactNode } from "react";
import type { PanelConfig } from "./primitives.js";
import { calculateSplitSizes } from "./primitives.js";
import { getPanelConfig } from "./panel-presets.js";
import { inkTheme } from "../theme/adapter-ink.js";
import { BORDER_CHARS } from "../theme/border-chars.js";

// ─── Panel 组件 ───────────────────────────

export interface PanelProps {
  /** 预设名称或自定义配置 */
  preset?: "chat" | "tool" | "permission" | "status" | "sidebar" | "input" | "taskTree" | "help" | "xilian";
  /** 自定义配置覆盖 */
  config?: Partial<PanelConfig>;
  /** 面板标题 */
  title?: string;
  /** 是否聚焦（高亮边框） */
  focused?: boolean;
  /** 子元素 */
  children: ReactNode;
  /** 宽度 */
  width?: number;
  /** 最大高度 */
  maxHeight?: number;
}

/**
 * 面板组件 — 统一的带边框容器
 */
export function Panel({
  preset,
  config: configOverrides,
  title,
  focused = false,
  children,
  width,
}: PanelProps) {
  const config = getPanelConfig(preset ?? null, { ...configOverrides, title: title ?? configOverrides?.title });
  const theme = inkTheme;
  const borderStyle = focused
    ? theme.borderFocus.borderStyle
    : theme.borderForStyle(config.border).borderStyle;
  const borderColor = focused
    ? theme.borderFocus.borderColor
    : theme.borderForStyle(config.border).borderColor;

  const paddingX = config.padding === "xxs" ? 0
    : config.padding === "xs" ? 1
    : config.padding === "sm" ? 2
    : config.padding === "md" ? 4
    : config.padding === "lg" ? 6
    : 8;

  if (!config.showBorder) {
    return (
      <Box flexDirection="column" paddingX={paddingX} width={width}>
        {children}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle={borderStyle}
      borderColor={borderColor}
      paddingX={paddingX}
      width={width}
    >
      {config.title && (
        <Box marginBottom={1}>
          {config.titleDecor && <Text color={theme.borderFocus.borderColor}>{config.titleDecor}</Text>}
          <Text bold color={theme.textPrimary.color}>{config.title}</Text>
        </Box>
      )}
      {children}
    </Box>
  );
}

// ─── SplitPane 组件 ───────────────────────

export interface SplitPaneProps {
  /** 分割方向 */
  direction?: "horizontal" | "vertical";
  /** 各分区大小配置 */
  sizes?: (number | "auto" | "min" | "max")[];
  /** 分隔线风格 */
  separator?: "thin" | "thick" | "none";
  /** 子元素（每个子元素为一个分区） */
  children: ReactNode[];
}

/**
 * 分割面板组件
 */
export function SplitPane({
  direction = "horizontal",
  sizes,
  separator = "thin",
  children,
}: SplitPaneProps) {
  const { stdout } = useStdout();
  const totalSize = direction === "horizontal"
    ? (stdout?.columns ?? 80)
    : (stdout?.rows ?? 24);

  const computedSizes = sizes
    ? calculateSplitSizes(totalSize, sizes, separator === "none" ? 0 : 1)
    : children.map(() => Math.floor(totalSize / children.length));

  const flexDirection = direction === "horizontal" ? "row" : "column";

  return (
    <Box flexDirection={flexDirection} flexGrow={1}>
      {children.map((child, i) => (
        <Box key={i} flexDirection="column" width={direction === "horizontal" ? computedSizes[i] : undefined}>
          {i > 0 && separator !== "none" && direction === "horizontal" && (
            <Text dimColor>{separator === "thick" ? "┃" : "│"}</Text>
          )}
          {child}
        </Box>
      ))}
    </Box>
  );
}

// ─── Separator 组件 ───────────────────────

export interface SeparatorProps {
  /** 分隔线风格 */
  style?: "thin" | "thick" | "dotted" | "double";
  /** 宽度（0 = 自动填满） */
  width?: number;
  /** 颜色 */
  color?: string;
}

/**
 * 分隔线组件
 */
export function Separator({ style = "thin", width = 0, color }: SeparatorProps) {
  const { stdout } = useStdout();
  const lineWidth = width || (stdout?.columns ?? 80);
  const chars = BORDER_CHARS[style === "thick" ? "bold" : style === "double" ? "double" : "single"];
  const line = chars.horizontal.repeat(lineWidth);

  return (
    <Box>
      <Text color={color} dimColor={!color}>{line}</Text>
    </Box>
  );
}
