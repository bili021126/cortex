/**
 * tui/animation/components/ProgressBar.tsx — 进度条 Ink 组件
 *
 * @module tui/animation/components/ProgressBar
 * @since v6
 */

import { Box, Text } from "ink";
import { useProgress, type ToolExecutionStatus, type ProgressBarStyle } from "../hooks/use-progress.js";

export interface ProgressBarProps {
  /** 工具执行状态 */
  status: ToolExecutionStatus;
  /** 已知进度 (0-100)，undefined 时为不确定进度 */
  progress?: number;
  /** 进度条风格 */
  style?: ProgressBarStyle;
  /** 进度条宽度 */
  width?: number;
  /** 是否显示标签 */
  showLabel?: boolean;
  /** 进度条颜色 */
  color?: string;
}

/**
 * 进度条组件
 */
export function ProgressBar({
  status,
  progress,
  style = "bar",
  width = 20,
  showLabel = true,
  color,
}: ProgressBarProps) {
  const { bar, label } = useProgress(status, progress, { style, width, showLabel });

  const barColor = status === "error"
    ? "red"
    : status === "complete"
      ? "green"
      : color ?? "cyan";

  return (
    <Box>
      <Text color={barColor}>{bar}</Text>
      {showLabel && (
        <Text dimColor> {label}</Text>
      )}
    </Box>
  );
}
