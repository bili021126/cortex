/**
 * tui/animation/components/Spinner.tsx — 加载指示器 Ink 组件
 *
 * @module tui/animation/components/Spinner
 * @since v6
 */

import { Box, Text } from "ink";
import { useSpinner, type SpinnerStyle } from "../hooks/use-spinner.js";

export interface SpinnerProps {
  /** 是否激活 */
  active?: boolean;
  /** spinner 风格 */
  style?: SpinnerStyle;
  /** 附加文字 */
  label?: string;
  /** 文字颜色 */
  color?: string;
}

/**
 * 加载指示器组件（替代 ink-spinner）
 */
export function Spinner({
  active = true,
  style = "bounce",
  label,
  color,
}: SpinnerProps) {
  const frame = useSpinner({ style, active });

  return (
    <Box>
      <Text color={color ?? "cyan"}>{frame}</Text>
      {label && <Text dimColor> {label}</Text>}
    </Box>
  );
}
