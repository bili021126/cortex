/**
 * tui/animation/components/FadeIn.tsx — 淡入 Ink 组件
 *
 * @module tui/animation/components/FadeIn
 * @since v6
 */

import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { useFadeIn, type UseFadeInOptions } from "../hooks/use-fade-in.js";

export interface FadeInProps {
  /** 是否触发淡入 */
  visible: boolean;
  /** 淡入选项 */
  options?: UseFadeInOptions;
  /** 子元素 */
  children: ReactNode;
}

/**
 * 淡入组件 — 内容渐显效果
 */
export function FadeIn({ visible, options = {}, children }: FadeInProps) {
  const { style } = useFadeIn(visible, options);

  return (
    <Box>
      <Text dimColor={style.dimColor} bold={style.bold}>
        {children}
      </Text>
    </Box>
  );
}
